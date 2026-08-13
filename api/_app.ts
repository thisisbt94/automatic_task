import express from "express";
import cors from "cors";
import { nanoid } from "nanoid";
import * as db from "./_db";
import { analyseTask, healthCheck, ServiceUnavailableError } from "./_ilmu";
import { AnalyseTaskInput, AnalysisResult } from "./_types";

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "change-me";

// Best-effort only: persists for the life of a warm function instance,
// not guaranteed across cold starts or multiple concurrent instances.
// Fine for "what broke recently" visibility during a live event; not
// an audit log. For a durable log, write errors to the DB instead.
const recentErrors: { at: string; message: string }[] = [];
function logError(message: string) {
  recentErrors.unshift({ at: new Date().toISOString(), message });
  if (recentErrors.length > 25) recentErrors.pop();
  console.error("[booth]", message);
}

// ── Sessions ────────────────────────────────────────────────────

app.post("/api/sessions", async (req, res) => {
  const id = nanoid(12);
  try {
    await db.createSession(id, String(req.body?.deviceHint || ""));
    res.json({ sessionId: id });
  } catch (err: any) {
    logError(`create-session failed: ${err?.message || err}`);
    res.status(500).json({ error: "Could not start a session." });
  }
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

    await db.insertSubmissionAndAnalysis({
      submissionId,
      sessionId: body.sessionId,
      resultId,
      task: body.task,
      frequency: body.frequency,
      timeSpent: body.timeSpent,
      sensitive: body.sensitive,
      department: body.department,
      clarificationHistory: body.clarificationHistory,
      analysisId: nanoid(12),
      category: analysis.category,
      automationPotential: analysis.automationPotential,
      automationScore: analysis.automationScore,
      difficulty: analysis.difficulty,
      source,
      analysis,
    });

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

app.get("/api/result/:resultId", async (req, res) => {
  try {
    const row = await db.getResultByResultId(req.params.resultId);
    if (!row) return res.status(404).json({ error: "Result not found. It may have expired." });
    res.json({
      resultId: row.result_id,
      createdAt: row.created_at,
      task: row.raw_task_text,
      frequency: row.frequency,
      timeSpent: row.time_spent,
      analysis: row.analysis_json,
      source: row.source,
    });
  } catch (err: any) {
    logError(`get-result failed: ${err?.message || err}`);
    res.status(500).json({ error: "Could not load that result." });
  }
});

app.post("/api/result/:resultId/email", async (req, res) => {
  const email = String(req.body?.email || "").trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: "Enter a valid email." });
  try {
    const ok = await db.setResultEmail(req.params.resultId, email);
    if (!ok) return res.status(404).json({ error: "Result not found." });
    // Prototype: no real mail transport wired up yet — see README
    // "Email delivery". Logged so the request is visible for now.
    console.log(`[booth] would email result ${req.params.resultId} to ${email}`);
    res.json({ ok: true });
  } catch (err: any) {
    logError(`email-result failed: ${err?.message || err}`);
    res.status(500).json({ error: "Could not save that email." });
  }
});

// ── Insights dashboard (anonymous, aggregated) ─────────────────────

app.get("/api/insights", async (req, res) => {
  try {
    const config = await db.getConfig();
    if (!config.dashboard_enabled) return res.status(403).json({ error: "Dashboard is turned off." });
    const { total, byCategory, byPotential, timeDistribution } = await db.getInsightsData();

    res.json({
      eventTitle: config.event_title,
      totalSubmissions: total,
      categories: byCategory.map((c) => ({ category: c.category, count: c.n, pct: total ? Math.round((c.n / total) * 100) : 0 })),
      automationPotential: byPotential.map((p) => ({ potential: p.potential, count: p.n, pct: total ? Math.round((p.n / total) * 100) : 0 })),
      timeDistribution,
      note: "Estimates are based only on ranges attendees selected themselves — not precise ROI figures.",
    });
  } catch (err: any) {
    logError(`insights failed: ${err?.message || err}`);
    res.status(500).json({ error: "Could not load insights." });
  }
});

app.get("/api/insights/feed", async (req, res) => {
  try {
    const rows = await db.getInsightsFeed();
    // Never surface raw text for sensitive submissions on the public feed.
    const feed = rows.map((r) =>
      r.sensitive === "Yes" ? { category: r.category, createdAt: r.createdAt, task: null } : { category: r.category, createdAt: r.createdAt, task: truncate(r.task, 90) }
    );
    res.json({ feed });
  } catch (err: any) {
    logError(`insights-feed failed: ${err?.message || err}`);
    res.status(500).json({ error: "Could not load the feed." });
  }
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
  try {
    const config = await db.getConfig();
    const { submissionsToday, totalSubmissions, topCategories } = await db.getAdminStatus();
    const ilmu = await healthCheck();
    res.json({
      ilmuStatus: ilmu,
      submissionsToday,
      totalSubmissions,
      topCategories,
      recentErrors,
      config: {
        eventTitle: config.event_title,
        dashboardEnabled: !!config.dashboard_enabled,
        kioskInactivitySeconds: config.kiosk_inactivity_seconds,
        retentionDays: config.retention_days,
      },
    });
  } catch (err: any) {
    logError(`admin-status failed: ${err?.message || err}`);
    res.status(500).json({ error: "Could not load admin status." });
  }
});

app.post("/api/admin/config", requireAdmin, async (req, res) => {
  try {
    const config = await db.updateConfig(req.body || {});
    res.json({ ok: true, config });
  } catch (err: any) {
    logError(`admin-config failed: ${err?.message || err}`);
    res.status(500).json({ error: "Could not save configuration." });
  }
});

app.post("/api/admin/reset-kiosk", requireAdmin, (req, res) => {
  // Nothing server-side to reset (kiosk state lives in the browser
  // tab) — endpoint kept for a future "push reset to all tablets"
  // feature and for a central admin action log either way.
  console.log("[booth] admin requested kiosk reset");
  res.json({ ok: true });
});

app.get("/api/admin/export.csv", requireAdmin, async (req, res) => {
  try {
    const rows = await db.getExportRows();
    const header = "result_id,created_at,frequency,time_spent,sensitive,department,category,automation_potential,automation_score,difficulty,source";
    const csv = [header, ...rows.map((r: any) => Object.values(r).map(csvCell).join(","))].join("\n");
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", "attachment; filename=booth-export.csv");
    res.send(csv);
  } catch (err: any) {
    logError(`export-csv failed: ${err?.message || err}`);
    res.status(500).json({ error: "Could not export data." });
  }
});

function csvCell(v: any) {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// ── Public config + health ─────────────────────────────────────

app.get("/api/config", async (req, res) => {
  try {
    const config = await db.getConfig();
    res.json({ eventTitle: config.event_title, dashboardEnabled: !!config.dashboard_enabled, kioskInactivitySeconds: config.kiosk_inactivity_seconds });
  } catch (err: any) {
    logError(`get-config failed: ${err?.message || err}`);
    res.status(500).json({ error: "Could not load configuration." });
  }
});

app.get("/api/health", async (req, res) => {
  res.json(await healthCheck());
});

export default app;
