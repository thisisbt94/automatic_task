import Database from "better-sqlite3";
import fs from "fs";
import path from "path";

const DB_PATH = process.env.DB_PATH || "./data/booth.sqlite";
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

export const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");

// ── Schema ──────────────────────────────────────────────────────
// Mirrors the tables requested in the brief. SQLite here for a
// zero-install prototype; every table maps 1:1 onto Postgres/Supabase
// if you outgrow this (see README "Swapping in Postgres/Supabase").

db.exec(`
CREATE TABLE IF NOT EXISTS event_configuration (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  event_title TEXT NOT NULL DEFAULT 'CAN MY TASK BE AUTOMATED?',
  dashboard_enabled INTEGER NOT NULL DEFAULT 1,
  kiosk_inactivity_seconds INTEGER NOT NULL DEFAULT 60,
  retention_days INTEGER NOT NULL DEFAULT 90
);
INSERT OR IGNORE INTO event_configuration (id) VALUES (1);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  device_hint TEXT
);

CREATE TABLE IF NOT EXISTS categories (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL UNIQUE
);
INSERT OR IGNORE INTO categories (id, label) VALUES
  ('reporting', 'Reporting & Consolidation'),
  ('meeting-followup', 'Meeting Follow-up'),
  ('info-search', 'Information Search'),
  ('approvals', 'Approvals'),
  ('admin-work', 'Administrative Work'),
  ('customer-support', 'Customer Questions'),
  ('other', 'Other');

CREATE TABLE IF NOT EXISTS task_submissions (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  result_id TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  raw_task_text TEXT NOT NULL,
  frequency TEXT NOT NULL,
  time_spent TEXT NOT NULL,
  sensitive TEXT NOT NULL,
  department TEXT,
  clarification_history TEXT NOT NULL DEFAULT '[]',
  email TEXT,
  FOREIGN KEY (session_id) REFERENCES sessions(id)
);

CREATE TABLE IF NOT EXISTS analysis_results (
  id TEXT PRIMARY KEY,
  submission_id TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  category TEXT NOT NULL,
  automation_potential TEXT NOT NULL,
  automation_score INTEGER NOT NULL,
  difficulty TEXT NOT NULL,
  source TEXT NOT NULL,
  analysis_json TEXT NOT NULL,
  FOREIGN KEY (submission_id) REFERENCES task_submissions(id)
);

CREATE INDEX IF NOT EXISTS idx_submissions_created ON task_submissions(created_at);
CREATE INDEX IF NOT EXISTS idx_results_category ON analysis_results(category);
`);

export function getConfig() {
  return db.prepare("SELECT * FROM event_configuration WHERE id = 1").get() as {
    id: number;
    event_title: string;
    dashboard_enabled: number;
    kiosk_inactivity_seconds: number;
    retention_days: number;
  };
}
