import "dotenv/config";
import { nanoid } from "nanoid";
import { db } from "./db";

// Seeds a handful of realistic-looking (but entirely synthetic) demo
// submissions so /insights has something to show while rehearsing the
// booth before the real event. Safe to run multiple times; safe to
// wipe by deleting the sqlite file. Run with: npm run seed:demo

const SAMPLES: { task: string; category: string; potential: "High" | "Medium" | "Low"; score: number; difficulty: "Low" | "Medium" | "High"; frequency: string; timeSpent: string; sensitive: string }[] = [
  { task: "Every Friday I collect project updates from 12 people and combine them into a report.", category: "Reporting & Consolidation", potential: "High", score: 86, difficulty: "Medium", frequency: "Weekly", timeSpent: "1–3 hours", sensitive: "No" },
  { task: "I turn meeting notes into a slide summary after every leadership meeting.", category: "Meeting Follow-up", potential: "High", score: 78, difficulty: "Medium", frequency: "Weekly", timeSpent: "30–60 minutes", sensitive: "No" },
  { task: "I answer the same handful of customer questions over and over by email.", category: "Customer Questions", potential: "High", score: 74, difficulty: "Low", frequency: "Daily", timeSpent: "1–3 hours", sensitive: "No" },
  { task: "I chase five departments for their monthly numbers before I can close the books.", category: "Reporting & Consolidation", potential: "High", score: 82, difficulty: "Medium", frequency: "Monthly", timeSpent: "3+ hours", sensitive: "Yes" },
  { task: "I copy data between our CRM and our spreadsheet every morning.", category: "Administrative Work", potential: "Medium", score: 61, difficulty: "Low", frequency: "Daily", timeSpent: "15–30 minutes", sensitive: "No" },
  { task: "I review and approve expense claims from my team each week.", category: "Approvals", potential: "Low", score: 34, difficulty: "High", frequency: "Weekly", timeSpent: "30–60 minutes", sensitive: "Yes" },
  { task: "I search old emails to find contract terms whenever a client asks.", category: "Information Search", potential: "Medium", score: 58, difficulty: "Medium", frequency: "Occasionally", timeSpent: "15–30 minutes", sensitive: "Yes" },
  { task: "I manually schedule interviews across three calendars.", category: "Administrative Work", potential: "Medium", score: 55, difficulty: "Low", frequency: "Weekly", timeSpent: "30–60 minutes", sensitive: "No" },
];

const now = Date.now();
let inserted = 0;

for (let i = 0; i < 40; i++) {
  const s = SAMPLES[i % SAMPLES.length];
  const submissionId = nanoid(12);
  const resultId = nanoid(6).toUpperCase();
  const createdAt = new Date(now - i * 37 * 60 * 1000).toISOString();
  const sessionId = nanoid(12);

  db.prepare("INSERT OR IGNORE INTO sessions (id, created_at, device_hint) VALUES (?, ?, ?)").run(sessionId, createdAt, "seed");

  db.prepare(
    `INSERT INTO task_submissions (id, session_id, result_id, created_at, raw_task_text, frequency, time_spent, sensitive, department, clarification_history)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(submissionId, sessionId, resultId, createdAt, s.task, s.frequency, s.timeSpent, s.sensitive, null, "[]");

  db.prepare(
    `INSERT INTO analysis_results (id, submission_id, created_at, category, automation_potential, automation_score, difficulty, source, analysis_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    nanoid(12),
    submissionId,
    createdAt,
    s.category,
    s.potential,
    s.score,
    s.difficulty,
    "demo",
    JSON.stringify({ taskSummary: s.task, category: s.category, automationPotential: s.potential, automationScore: s.score })
  );

  inserted++;
}

console.log(`[booth] seeded ${inserted} demo submissions.`);
