import "dotenv/config";
import express from "express";
import cors from "cors";
import { nanoid } from "nanoid";
import { db, getConfig } from "./db";
import { analyseTask, healthCheck, ServiceUnavailableError } from "./ilmu";
import { AnalyseTaskInput, AnalysisResult } from "./types";

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

const PORT = Number(process.env.PORT || 4000);
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "change-me";

// In-memory ring buffer of recent errors, for /api/admin/status.
// Deliberately not persisted — this is operational visibility for the
// booth staff during the event, not an audit log.
const recentErrors: { at: string; message: string }[] = [];
function logError(message: string) {
  recentErrors.unshift({ at: new Date().toISOString(), message });
  if (recentErrors.length > 25) recentErrors.pop();
  console.error("[booth]", message);
}

// ── Sessions ────────────────────────────────────────────────────

app.post("/api/sessions", (req, res) => {
  const id = nanoid(12);
  db.prepare("INSERT INTO sessions (id, created_at, device_hint) VALUES (?, ?, ?)").run(
    id,
    new Date().toISOString(),
    String(req.body?.deviceHint || "")
  );
  res.json({ sessionId: id });
});

// ── Analyse (with clarification loop) ─────────────────────────────

app.post("/api/analyse", async (req, res) => {
  const body = req.body as AnalyseTaskInput;
  if (!body?.sessionId || !body?.task || !body?.frequency || !body?.timeSpent || !body?.sensitive) {
    return res.status(400).json({ error: "Missing required fields." });
  }
  if (!Array.isArray(body.clarificationHistory)) body.clarificationHistory = [];

  try {
    const { result, source } = await analyseTask(body);

    if ("needsClarification" in result && result.needsClarification) {
      return res.json({ needsClarification: true, question: result.question });
    }

    const analysis = result as AnalysisResult;
    const submissionId = nanoid(12);
    const resultId = nanoid(6).toUpperCase();
    const now = new Date().toISOString();

    db.prepare(
      `INSERT INTO task_submissions
        (id, session_id, result_id, created_at, raw_task_text, frequency, time_spent, sensitive, department, clarification_history)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      submissionId,
      body.sessionId,
      resultId,
      now,
      body.task,
      body.frequency,
      body.timeSpent,
      body.sensitive,
      body.department || null,
      JSON.stringify(body.clarificationHistory)
    );

    db.prepare(
      `INSERT INTO analysis_results
        (id, submission_id, created_at, category, automation_potential, automation_score, difficulty, source, analysis_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(nanoid(12), submissionId, now, analysis.category, analysis.automationPotential, analysis.automationScore, analysis.difficulty, source, JSON.stringify(analysis));

    res.json({ needsClarification: false, resultId, analysis, source });
  } catch (err: any) {
    logError(`analyse-task failed: ${err?.message || err}`);
    if (err instanceof ServiceUnavailableError) {
      return res.status(503).json({ error: "The AI service is unavailable right now. Please try again in a moment.", detail: err.message });
    }
    res.status(500).json({ error: "Something went wrong analysing that task." });
  }
});

// ── Result lookup (QR / "take it with you") ───────────────────────

app.get("/api/result/:resultId", (req, res) => {
  const row = db
    .prepare(
      `SELECT ts.*, ar.category, ar.automation_potential, ar.automation_score, ar.difficulty, ar.analysis_json, ar.source
       FROM task_submissions ts JOIN analysis_results ar ON ar.submission_id = ts.id
       WHERE ts.result_id = ?`
    )
    .get(req.params.resultId.toUpperCase()) as any;

  if (!row) return res.status(404).json({ error: "Result not found. It may have expired." });

  res.json({
    resultId: row.result_id,
    createdAt: row.created_at,
    task: row.raw_task_text,
    frequency: row.frequency,
    timeSpent: row.time_spent,
    analysis: JSON.parse(row.analysis_json),
    source: row.source,
  });
});

app.post("/api/result/:resultId/email", (req, res) => {
  const email = String(req.body?.email || "").trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: "Enter a valid email." });

  const info = db.prepare("UPDATE task_submissions SET email = ? WHERE result_id = ?").run(email, req.params.resultId.toUpperCase());
  if (info.changes === 0) return res.status(404).json({ error: "Result not found." });

  // Prototype: no real mail transport wired up. Logged instead so the
  // request is visible during rehearsal. See README "Email delivery".
  console.log(`[booth] would email result ${req.params.resultId} to ${email}`);
  res.json({ ok: true });
});

// ── Insights dashboard (anonymous, aggregated) ─────────────────────

app.get("/api/insights", (req, res) => {
  const config = getConfig();
  if (!config.dashboard_enabled) return res.status(403).json({ error: "Dashboard is turned off." });

  const total = (db.prepare("SELECT COUNT(*) AS n FROM task_submissions").get() as any).n as number;

  const byCategory = db
    .prepare(
      `SELECT category, COUNT(*) AS n FROM analysis_results GROUP BY category ORDER BY n DESC`
    )
    .all() as { category: string; n: number }[];

  const byPotential = db
    .prepare(`SELECT automation_potential AS potential, COUNT(*) AS n FROM analysis_results GROUP BY automation_potential`)
    .all() as { potential: string; n: number }[];

  const timeDistribution = db
    .prepare(`SELECT time_spent AS timeSpent, COUNT(*) AS n FROM task_submissions GROUP BY time_spent`)
    .all() as { timeSpent: string; n: number }[];

  res.json({
    eventTitle: config.event_title,
    totalSubmissions: total,
    categories: byCategory.map((c) => ({ category: c.category, count: c.n, pct: total ? Math.round((c.n / total) * 100) : 0 })),
    automationPotential: byPotential.map((p) => ({ potential: p.potential, count: p.n, pct: total ? Math.round((p.n / total) * 100) : 0 })),
    timeDistribution,
    note: "Estimates are based only on ranges attendees selected themselves — not precise ROI figures.",
  });
});

app.get("/api/insights/feed", (req, res) => {
  const rows = db
    .prepare(
      `SELECT ts.raw_task_text AS task, ar.category, ar.created_at AS createdAt, ts.sensitive
       FROM task_submissions ts JOIN analysis_results ar ON ar.submission_id = ts.id
       ORDER BY ts.created_at DESC LIMIT 12`
    )
    .all() as any[];

  // Never surface raw text for sensitive submissions on the public feed —
  // show the category only.
  const feed = rows.map((r) =>
    r.sensitive === "Yes"
      ? { category: r.category, createdAt: r.createdAt, task: null }
      : { category: r.category, createdAt: r.createdAt, task: truncate(r.task, 90) }
  );
  res.json({ feed });
});

function truncate(s: string, n: number) {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

// ── Admin ───────────────────────────────────────────────────────

function requireAdmin(req: express.Request, res: express.Response, next: express.NextFunction) {
  const pass = req.header("x-admin-password") || req.query.password;
  if (pass !== ADMIN_PASSWORD) return res.status(401).json({ error: "Unauthorized" });
  next();
}

app.get("/api/admin/status", requireAdmin, async (req, res) => {
  const config = getConfig();
  const submissionsToday = (
    db.prepare("SELECT COUNT(*) AS n FROM task_submissions WHERE created_at >= ?").get(new Date().toISOString().slice(0, 10)) as any
  ).n as number;
  const topCategories = db
    .prepare(`SELECT category, COUNT(*) AS n FROM analysis_results GROUP BY category ORDER BY n DESC LIMIT 5`)
    .all();
  const ilmu = await healthCheck();

  res.json({
    ilmuStatus: ilmu,
    submissionsToday,
    totalSubmissions: (db.prepare("SELECT COUNT(*) AS n FROM task_submissions").get() as any).n,
    topCategories,
    recentErrors,
    config: {
      eventTitle: config.event_title,
      dashboardEnabled: !!config.dashboard_enabled,
      kioskInactivitySeconds: config.kiosk_inactivity_seconds,
      retentionDays: config.retention_days,
    },
  });
});

app.post("/api/admin/config", requireAdmin, (req, res) => {
  const { eventTitle, dashboardEnabled, kioskInactivitySeconds, retentionDays } = req.body || {};
  const current = getConfig();
  db.prepare(
    `UPDATE event_configuration SET event_title = ?, dashboard_enabled = ?, kiosk_inactivity_seconds = ?, retention_days = ? WHERE id = 1`
  ).run(
    eventTitle ?? current.event_title,
    dashboardEnabled === undefined ? current.dashboard_enabled : dashboardEnabled ? 1 : 0,
    kioskInactivitySeconds ?? current.kiosk_inactivity_seconds,
    retentionDays ?? current.retention_days
  );
  res.json({ ok: true, config: getConfig() });
});

app.post("/api/admin/reset-kiosk", requireAdmin, (req, res) => {
  // Nothing server-side to reset today (kiosk state lives in the
  // browser tab) — this endpoint exists so a future "push reset to all
  // tablets" feature has somewhere to live, and so admin actions are
  // logged centrally either way.
  console.log("[booth] admin requested kiosk reset");
  res.json({ ok: true });
});

app.get("/api/admin/export.csv", requireAdmin, (req, res) => {
  const rows = db
    .prepare(
      `SELECT ts.result_id, ts.created_at, ts.frequency, ts.time_spent, ts.sensitive, ts.department,
              ar.category, ar.automation_potential, ar.automation_score, ar.difficulty, ar.source
       FROM task_submissions ts JOIN analysis_results ar ON ar.submission_id = ts.id
       ORDER BY ts.created_at ASC`
    )
    .all() as any[];

  const header = "result_id,created_at,frequency,time_spent,sensitive,department,category,automation_potential,automation_score,difficulty,source";
  const csv = [header, ...rows.map((r) => Object.values(r).map(csvCell).join(","))].join("\n");
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", "attachment; filename=booth-export.csv");
  res.send(csv);
});

function csvCell(v: any) {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// ── Public config + health ─────────────────────────────────────

app.get("/api/config", (req, res) => {
  const config = getConfig();
  res.json({
    eventTitle: config.event_title,
    dashboardEnabled: !!config.dashboard_enabled,
    kioskInactivitySeconds: config.kiosk_inactivity_seconds,
  });
});

app.get("/api/health", async (req, res) => {
  res.json(await healthCheck());
});

app.listen(PORT, () => {
  console.log(`[booth] server listening on :${PORT} (DEMO_MODE=${process.env.DEMO_MODE ?? "true"})`);
});
