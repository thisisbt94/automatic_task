export type Frequency = "Daily" | "Weekly" | "Monthly" | "Occasionally";
export type TimeSpent = "<15 minutes" | "15–30 minutes" | "30–60 minutes" | "1–3 hours" | "3+ hours";
export type Sensitive = "Yes" | "No" | "Not sure";

export interface WorkflowStep {
  step: number;
  label: string;
  description: string;
}

export interface AnalysisResult {
  taskSummary: string;
  category: string;
  automationPotential: "High" | "Medium" | "Low";
  automationScore: number;
  why: string;
  automatableSteps: string[];
  humanStillNeededFor: string[];
  suggestedWorkflow: WorkflowStep[];
  difficulty: "Low" | "Medium" | "High";
  possibleTools: string[];
  estimatedBenefit: string;
  nextStep: string;
  followUpQuestions: string[];
}

export interface ClarificationTurn {
  question: string;
  answer: string;
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data?.error || `Request failed (${res.status})`);
    (err as any).status = res.status;
    (err as any).detail = data?.detail;
    throw err;
  }
  return data as T;
}

export function createSession(deviceHint = "") {
  return req<{ sessionId: string }>("/sessions", { method: "POST", body: JSON.stringify({ deviceHint }) });
}

export function analyseTask(payload: {
  sessionId: string;
  task: string;
  frequency: Frequency;
  timeSpent: TimeSpent;
  sensitive: Sensitive;
  clarificationHistory: ClarificationTurn[];
}) {
  return req<
    | { needsClarification: true; question: string }
    | { needsClarification: false; resultId: string; analysis: AnalysisResult; source: string }
  >("/analyse", { method: "POST", body: JSON.stringify(payload) });
}

export function getResult(resultId: string) {
  return req<{
    resultId: string;
    createdAt: string;
    task: string;
    frequency: string;
    timeSpent: string;
    analysis: AnalysisResult;
    source: string;
  }>(`/result/${resultId}`);
}

export function emailResult(resultId: string, email: string) {
  return req<{ ok: true }>(`/result/${resultId}/email`, { method: "POST", body: JSON.stringify({ email }) });
}

export function getInsights() {
  return req<{
    eventTitle: string;
    totalSubmissions: number;
    categories: { category: string; count: number; pct: number }[];
    automationPotential: { potential: string; count: number; pct: number }[];
    timeDistribution: { timeSpent: string; n: number }[];
    note: string;
  }>("/insights");
}

export function getInsightsFeed() {
  return req<{ feed: { category: string; createdAt: string; task: string | null }[] }>("/insights/feed");
}

export function getPublicConfig() {
  return req<{ eventTitle: string; dashboardEnabled: boolean; kioskInactivitySeconds: number }>("/config");
}

export function adminStatus(password: string) {
  return req<any>("/admin/status", { headers: { "x-admin-password": password } });
}

export function adminUpdateConfig(password: string, body: Record<string, unknown>) {
  return req<any>("/admin/config", { method: "POST", headers: { "x-admin-password": password, "Content-Type": "application/json" }, body: JSON.stringify(body) });
}

export function adminExportCsvUrl(password: string) {
  return `/api/admin/export.csv?password=${encodeURIComponent(password)}`;
}
