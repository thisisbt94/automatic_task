import { Pool } from "pg";

// Postgres replacement for server/src/db.ts (which used SQLite —
// fine for a standalone host, but Vercel functions have no
// persistent disk, so the serverless path needs a real database).
//
// Uses the plain `pg` driver over a real TCP/TLS connection rather
// than @neondatabase/serverless's HTTP-fetch driver — the latter hit
// a known, widely-reported "TypeError: fetch failed" failure mode on
// Vercel's Node runtime (undici/fetch-layer issue, unrelated to
// connection-string correctness). `pg` avoids that class of failure
// entirely and works with any Postgres, not just Neon.
//
// Add the Neon integration from Vercel's Storage tab (or any other
// Postgres) and it injects DATABASE_URL automatically. See README
// "Vercel + Postgres deployment".
const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL;
if (!connectionString) {
  console.warn("[booth] DATABASE_URL / POSTGRES_URL is not set — database calls will fail.");
}

const pool = new Pool({
  connectionString: connectionString || "postgres://unset:unset@localhost/unset",
  // Neon (and most managed Postgres) require TLS; connection strings
  // already carry sslmode=require, but some serverless environments
  // need this set explicitly too since there's no interactive prompt
  // to accept the CA.
  ssl: connectionString ? { rejectUnauthorized: false } : undefined,
  max: 3,
});

// Minimal tagged-template helper so the rest of this file can stay
// written as `sql\`SELECT ... ${value}\`` exactly as before — swapping
// drivers again later (Postgres is Postgres) only means changing this
// one function, not every query below.
function sql(strings: TemplateStringsArray, ...values: unknown[]) {
  let text = "";
  strings.forEach((chunk, i) => {
    text += chunk;
    if (i < values.length) text += `$${i + 1}`;
  });
  return pool.query(text, values as any[]).then((res) => ({ rows: res.rows, rowCount: res.rowCount ?? 0 }));
}

let schemaReady: Promise<void> | null = null;

export function ensureSchema(): Promise<void> {
  if (!schemaReady) schemaReady = createSchema();
  return schemaReady;
}

async function createSchema() {
  await sql`
    CREATE TABLE IF NOT EXISTS event_configuration (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      event_title TEXT NOT NULL DEFAULT 'CAN MY TASK BE AUTOMATED?',
      dashboard_enabled BOOLEAN NOT NULL DEFAULT TRUE,
      kiosk_inactivity_seconds INTEGER NOT NULL DEFAULT 60,
      retention_days INTEGER NOT NULL DEFAULT 90
    );
  `;
  await sql`INSERT INTO event_configuration (id) VALUES (1) ON CONFLICT (id) DO NOTHING;`;

  await sql`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      created_at TIMESTAMPTZ NOT NULL,
      device_hint TEXT
    );
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS task_submissions (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(id),
      result_id TEXT NOT NULL UNIQUE,
      created_at TIMESTAMPTZ NOT NULL,
      raw_task_text TEXT NOT NULL,
      frequency TEXT NOT NULL,
      time_spent TEXT NOT NULL,
      sensitive TEXT NOT NULL,
      department TEXT,
      clarification_history JSONB NOT NULL DEFAULT '[]',
      email TEXT
    );
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS analysis_results (
      id TEXT PRIMARY KEY,
      submission_id TEXT NOT NULL UNIQUE REFERENCES task_submissions(id),
      created_at TIMESTAMPTZ NOT NULL,
      category TEXT NOT NULL,
      automation_potential TEXT NOT NULL,
      automation_score INTEGER NOT NULL,
      difficulty TEXT NOT NULL,
      source TEXT NOT NULL,
      analysis_json JSONB NOT NULL
    );
  `;

  await sql`CREATE INDEX IF NOT EXISTS idx_submissions_created ON task_submissions(created_at);`;
  await sql`CREATE INDEX IF NOT EXISTS idx_results_category ON analysis_results(category);`;
}

// ── Config ──────────────────────────────────────────────────────

export async function getConfig() {
  await ensureSchema();
  const { rows } = await sql`SELECT * FROM event_configuration WHERE id = 1;`;
  return rows[0] as {
    id: number;
    event_title: string;
    dashboard_enabled: boolean;
    kiosk_inactivity_seconds: number;
    retention_days: number;
  };
}

export async function updateConfig(patch: { eventTitle?: string; dashboardEnabled?: boolean; kioskInactivitySeconds?: number; retentionDays?: number }) {
  const current = await getConfig();
  await sql`
    UPDATE event_configuration SET
      event_title = ${patch.eventTitle ?? current.event_title},
      dashboard_enabled = ${patch.dashboardEnabled ?? current.dashboard_enabled},
      kiosk_inactivity_seconds = ${patch.kioskInactivitySeconds ?? current.kiosk_inactivity_seconds},
      retention_days = ${patch.retentionDays ?? current.retention_days}
    WHERE id = 1;
  `;
  return getConfig();
}

// ── Sessions ────────────────────────────────────────────────────

export async function createSession(id: string, deviceHint: string) {
  await ensureSchema();
  await sql`INSERT INTO sessions (id, created_at, device_hint) VALUES (${id}, NOW(), ${deviceHint});`;
}

// ── Submissions + analysis ─────────────────────────────────────

export async function insertSubmissionAndAnalysis(args: {
  submissionId: string;
  sessionId: string;
  resultId: string;
  task: string;
  frequency: string;
  timeSpent: string;
  sensitive: string;
  department?: string | null;
  clarificationHistory: unknown[];
  analysisId: string;
  category: string;
  automationPotential: string;
  automationScore: number;
  difficulty: string;
  source: string;
  analysis: unknown;
}) {
  await ensureSchema();
  await sql`
    INSERT INTO task_submissions
      (id, session_id, result_id, created_at, raw_task_text, frequency, time_spent, sensitive, department, clarification_history)
    VALUES (${args.submissionId}, ${args.sessionId}, ${args.resultId}, NOW(), ${args.task}, ${args.frequency}, ${args.timeSpent}, ${args.sensitive}, ${args.department ?? null}, ${JSON.stringify(args.clarificationHistory)});
  `;
  await sql`
    INSERT INTO analysis_results
      (id, submission_id, created_at, category, automation_potential, automation_score, difficulty, source, analysis_json)
    VALUES (${args.analysisId}, ${args.submissionId}, NOW(), ${args.category}, ${args.automationPotential}, ${args.automationScore}, ${args.difficulty}, ${args.source}, ${JSON.stringify(args.analysis)});
  `;
}

export async function getResultByResultId(resultId: string) {
  await ensureSchema();
  const { rows } = await sql`
    SELECT ts.*, ar.category, ar.automation_potential, ar.automation_score, ar.difficulty, ar.analysis_json, ar.source
    FROM task_submissions ts JOIN analysis_results ar ON ar.submission_id = ts.id
    WHERE ts.result_id = ${resultId.toUpperCase()};
  `;
  return rows[0] as any;
}

export async function setResultEmail(resultId: string, email: string) {
  await ensureSchema();
  const { rowCount } = await sql`UPDATE task_submissions SET email = ${email} WHERE result_id = ${resultId.toUpperCase()};`;
  return rowCount > 0;
}

// ── Insights ────────────────────────────────────────────────────

export async function getInsightsData() {
  await ensureSchema();
  const total = (await sql`SELECT COUNT(*)::int AS n FROM task_submissions;`).rows[0].n as number;
  const byCategory = (await sql`SELECT category, COUNT(*)::int AS n FROM analysis_results GROUP BY category ORDER BY n DESC;`).rows as {
    category: string;
    n: number;
  }[];
  const byPotential = (await sql`SELECT automation_potential AS potential, COUNT(*)::int AS n FROM analysis_results GROUP BY automation_potential;`)
    .rows as { potential: string; n: number }[];
  const timeDistribution = (await sql`SELECT time_spent AS "timeSpent", COUNT(*)::int AS n FROM task_submissions GROUP BY time_spent;`).rows as {
    timeSpent: string;
    n: number;
  }[];
  return { total, byCategory, byPotential, timeDistribution };
}

export async function getInsightsFeed() {
  await ensureSchema();
  const { rows } = await sql`
    SELECT ts.raw_task_text AS task, ar.category, ts.created_at AS "createdAt", ts.sensitive
    FROM task_submissions ts JOIN analysis_results ar ON ar.submission_id = ts.id
    ORDER BY ts.created_at DESC LIMIT 12;
  `;
  return rows as { task: string; category: string; createdAt: string; sensitive: string }[];
}

// ── Admin ───────────────────────────────────────────────────────

export async function getAdminStatus() {
  await ensureSchema();
  const submissionsToday = (
    await sql`SELECT COUNT(*)::int AS n FROM task_submissions WHERE created_at >= date_trunc('day', NOW());`
  ).rows[0].n as number;
  const totalSubmissions = (await sql`SELECT COUNT(*)::int AS n FROM task_submissions;`).rows[0].n as number;
  const topCategories = (await sql`SELECT category, COUNT(*)::int AS n FROM analysis_results GROUP BY category ORDER BY n DESC LIMIT 5;`).rows;
  return { submissionsToday, totalSubmissions, topCategories };
}

export async function getExportRows() {
  await ensureSchema();
  const { rows } = await sql`
    SELECT ts.result_id, ts.created_at, ts.frequency, ts.time_spent, ts.sensitive, ts.department,
           ar.category, ar.automation_potential, ar.automation_score, ar.difficulty, ar.source
    FROM task_submissions ts JOIN analysis_results ar ON ar.submission_id = ts.id
    ORDER BY ts.created_at ASC;
  `;
  return rows;
}
