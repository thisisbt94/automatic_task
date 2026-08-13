import { AnalyseTaskInput, IlmuResponse, AnalysisResult } from "./_types";

// Same logic as server/src/ilmu.ts, ported for Vercel's Node runtime,
// which ships a global fetch (no node-fetch dependency needed here).

const DEMO_MODE = (process.env.DEMO_MODE ?? "true").toLowerCase() !== "false";
const AI_PROVIDER = (process.env.AI_PROVIDER || "ilmu").toLowerCase();

const SYSTEM_PROMPT = `You are an enterprise automation discovery consultant. Your job is to understand a person's repetitive work process and determine realistically which parts may benefit from AI or automation.

Never claim an entire job should be automated.
Break tasks into steps.
Distinguish deterministic automation from AI-assisted work and human judgement.
Be conservative about automation potential.
If the task description is ambiguous, ask one concise clarification question.
Use language that a non-technical business leader can understand.
Never invent integration capabilities.
Never claim guaranteed time savings.
Flag security, privacy, regulatory or human approval considerations when relevant.
Respond only in the requested JSON schema. Return raw JSON only — no markdown fences, no commentary.

If you have enough information, respond with exactly this shape:
{
  "taskSummary": string,
  "category": string,
  "automationPotential": "High" | "Medium" | "Low",
  "automationScore": number (0-100),
  "why": string,
  "automatableSteps": string[],
  "humanStillNeededFor": string[],
  "suggestedWorkflow": [{ "step": number, "label": string, "description": string }],
  "difficulty": "Low" | "Medium" | "High",
  "possibleTools": string[],
  "estimatedBenefit": string,
  "nextStep": string,
  "followUpQuestions": string[]
}

If the description is too vague to analyse responsibly (fewer than ~2 clarification rounds so far), respond with exactly this shape instead:
{ "needsClarification": true, "question": string }

Never ask more than one clarification question at a time. Never ask a clarification question after 2 rounds have already happened — analyse with what you have instead, noting the uncertainty in "why".`;

export class ServiceUnavailableError extends Error {}

export async function healthCheck(): Promise<{ ok: boolean; provider: string; demoMode: boolean; detail?: string }> {
  if (DEMO_MODE) return { ok: true, provider: "demo-heuristic", demoMode: true };
  try {
    if (AI_PROVIDER === "n8n") {
      const url = process.env.N8N_AUTOMATION_WEBHOOK_URL;
      if (!url) return { ok: false, provider: "n8n", demoMode: false, detail: "N8N_AUTOMATION_WEBHOOK_URL not set" };
      return { ok: true, provider: "n8n", demoMode: false };
    }
    const apiUrl = process.env.ILMU_API_URL;
    const apiKey = process.env.ILMU_API_KEY;
    if (!apiUrl || !apiKey) return { ok: false, provider: "ilmu", demoMode: false, detail: "ILMU_API_URL / ILMU_API_KEY not set" };
    const res = await fetch(`${apiUrl}/models`, { headers: { Authorization: `Bearer ${apiKey}` } });
    return { ok: res.ok, provider: "ilmu", demoMode: false, detail: res.ok ? undefined : `HTTP ${res.status}` };
  } catch (err: any) {
    return { ok: false, provider: AI_PROVIDER, demoMode: false, detail: err?.message || "unreachable" };
  }
}

export async function analyseTask(input: AnalyseTaskInput): Promise<{ result: IlmuResponse; source: "demo" | "ilmu" | "n8n" }> {
  if (DEMO_MODE) return { result: heuristicAnalyse(input), source: "demo" };
  if (AI_PROVIDER === "n8n") return { result: await callN8n(input), source: "n8n" };
  return { result: await callIlmu(input), source: "ilmu" };
}

async function callIlmu(input: AnalyseTaskInput): Promise<IlmuResponse> {
  const apiUrl = process.env.ILMU_API_URL;
  const apiKey = process.env.ILMU_API_KEY;
  const model = process.env.ILMU_MODEL || "ilmu-v3.1";
  if (!apiUrl || !apiKey) throw new ServiceUnavailableError("ILMU is not configured (ILMU_API_URL / ILMU_API_KEY missing).");

  const res = await fetch(`${apiUrl}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      temperature: 0.3,
      max_tokens: 900,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: buildUserPrompt(input) },
      ],
    }),
  });

  if (!res.ok) throw new ServiceUnavailableError(`ILMU returned HTTP ${res.status}`);
  const data: any = await res.json();
  const text = data?.choices?.[0]?.message?.content;
  if (!text) throw new ServiceUnavailableError("ILMU returned an empty response.");
  return parseModelJson(text);
}

async function callN8n(input: AnalyseTaskInput): Promise<IlmuResponse> {
  const url = process.env.N8N_AUTOMATION_WEBHOOK_URL;
  const secret = process.env.N8N_SHARED_SECRET;
  if (!url) throw new ServiceUnavailableError("n8n is not configured (N8N_AUTOMATION_WEBHOOK_URL missing).");

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(secret ? { "x-agent-token": secret } : {}) },
    body: JSON.stringify({
      action: "analyse-task",
      experience: "automation-booth",
      sessionId: input.sessionId,
      task: input.task,
      frequency: input.frequency,
      timeSpent: input.timeSpent,
      sensitive: input.sensitive,
      clarificationHistory: input.clarificationHistory,
    }),
  });

  if (!res.ok) throw new ServiceUnavailableError(`n8n returned HTTP ${res.status}`);
  const data: any = await res.json();
  if (!data?.success) throw new ServiceUnavailableError("n8n reported failure for analyse-task.");
  if (data.analysis?.needsClarification) return { needsClarification: true, question: data.analysis.question };
  return data.analysis as AnalysisResult;
}

function buildUserPrompt(input: AnalyseTaskInput): string {
  const history = input.clarificationHistory.map((t, i) => `Clarification ${i + 1} — Q: ${t.question} / A: ${t.answer}`).join("\n");
  return [
    `Task description: "${input.task}"`,
    `How often: ${input.frequency}`,
    `Roughly how long each time: ${input.timeSpent}`,
    `Involves sensitive/confidential information: ${input.sensitive}`,
    history ? `Prior clarification rounds so far (${input.clarificationHistory.length}):\n${history}` : "No clarification rounds yet.",
  ].join("\n");
}

function parseModelJson(text: string): IlmuResponse {
  const cleaned = text.trim().replace(/^```(json)?/i, "").replace(/```$/, "").trim();
  const parsed = JSON.parse(cleaned);
  if (parsed.needsClarification) return { needsClarification: true, question: String(parsed.question || "Could you tell me a bit more about that?") };
  return parsed as AnalysisResult;
}

// ── DEMO_MODE heuristic (identical to server/src/ilmu.ts) ─────────

const CATEGORY_RULES: { id: string; label: string; keywords: string[] }[] = [
  { id: "reporting", label: "Reporting & Consolidation", keywords: ["report", "consolidat", "combine", "collate", "powerpoint", "deck", "summary", "summarise", "summarize", "compile", "update deck", "dashboard"] },
  { id: "meeting-followup", label: "Meeting Follow-up", keywords: ["meeting", "minutes", "action item", "follow up", "follow-up", "notes"] },
  { id: "info-search", label: "Information Search", keywords: ["find", "search", "look up", "inbox", "email", "locate", "dig through"] },
  { id: "approvals", label: "Approvals", keywords: ["approve", "approval", "sign off", "signoff", "review and approve"] },
  { id: "admin-work", label: "Administrative Work", keywords: ["data entry", "copy", "paste", "file", "filing", "form", "spreadsheet", "excel", "invoice", "schedule", "booking", "expense"] },
  { id: "customer-support", label: "Customer Questions", keywords: ["customer", "client", "enquir", "inquir", "faq", "support ticket", "same questions"] },
];

const AUTOMATABLE_VERBS = ["collect", "combine", "chase", "follow up", "remind", "forward", "copy", "paste", "compile", "consolidat", "summar", "format", "schedule", "send", "extract", "sort", "file", "search", "look up", "notify"];
const JUDGEMENT_HINTS = ["decide", "decision", "negotiat", "approve", "judgement", "judgment", "sensitive", "confidential", "strategy", "persuad", "creative", "relationship"];

function heuristicAnalyse(input: AnalyseTaskInput): IlmuResponse {
  const text = input.task.toLowerCase().trim();
  const rounds = input.clarificationHistory.length;
  const combined = [text, ...input.clarificationHistory.map((t) => t.answer.toLowerCase())].join(" ");
  const wordCount = combined.split(/\s+/).filter(Boolean).length;
  const hasVerbSignal = AUTOMATABLE_VERBS.some((v) => combined.includes(v));

  if (rounds < 2 && wordCount < 6 && !hasVerbSignal) {
    return { needsClarification: true, question: pickClarificationQuestion(combined) };
  }

  const category = CATEGORY_RULES.find((c) => c.keywords.some((k) => combined.includes(k))) ?? { id: "other", label: "Other", keywords: [] };
  const verbHits = AUTOMATABLE_VERBS.filter((v) => combined.includes(v)).length;
  const judgementHits = JUDGEMENT_HINTS.filter((v) => combined.includes(v)).length;

  let score = 35 + verbHits * 9 - judgementHits * 8;
  if (input.frequency === "Daily" || input.frequency === "Weekly") score += 8;
  if (input.timeSpent === "1–3 hours" || input.timeSpent === "3+ hours") score += 6;
  if (input.sensitive === "Yes") score -= 12;
  score = Math.max(10, Math.min(92, Math.round(score)));

  const potential = score >= 70 ? "High" : score >= 40 ? "Medium" : "Low";
  const difficulty = judgementHits > 1 ? "High" : verbHits >= 3 ? "Low" : "Medium";
  const automatableSteps = buildAutomatableSteps(combined);
  const humanSteps = buildHumanSteps(input);
  const workflow = buildWorkflow(automatableSteps);

  const headline =
    potential === "High"
      ? "Most of this looks like collecting, organising and formatting information."
      : potential === "Medium"
      ? "Parts of this follow a repeatable pattern that AI could help draft or organise."
      : "This leans on judgement calls and relationships that are hard to hand off.";

  return {
    taskSummary: buildSummary(input),
    category: category.label,
    automationPotential: potential,
    automationScore: score,
    why: headline,
    automatableSteps,
    humanStillNeededFor: humanSteps,
    suggestedWorkflow: workflow,
    difficulty,
    possibleTools: ["ILMU", "n8n", "Microsoft Teams", "Excel"],
    estimatedBenefit:
      potential === "High"
        ? "Could meaningfully cut down the repetitive collecting/formatting portion of this task."
        : potential === "Medium"
        ? "Could take a first pass at the repetitive parts, leaving you to review and finish."
        : "Automation would mostly save small pockets of time around the edges.",
    nextStep:
      potential === "Low"
        ? "Map exactly which small sub-steps are repetitive — even a judgement-heavy task usually has a few."
        : "Map where the information currently comes from and where the finished output needs to go.",
    followUpQuestions: ["Where does the information currently come from?", "Where does the finished output need to end up?"],
  };
}

function pickClarificationQuestion(text: string): string {
  if (text.includes("inbox") || text.includes("email")) return "What takes the most time — reading emails, finding important ones, replying, or organising them?";
  if (text.includes("messy") || text.length < 20) return "Could you describe one specific example of when this happens, step by step?";
  return "What's the very first thing you do when this task starts, and what does 'done' look like?";
}

function buildSummary(input: AnalyseTaskInput): string {
  const t = input.task.trim();
  const capped = t.charAt(0).toUpperCase() + t.slice(1);
  return capped.length > 140 ? capped.slice(0, 137) + "…" : capped;
}

function buildAutomatableSteps(combined: string): string[] {
  const steps: string[] = [];
  if (combined.match(/collect|chase|follow up|remind/)) steps.push("Request and collect the information automatically");
  if (combined.match(/copy|paste|file|sort|extract/)) steps.push("Move information between systems without manual copy/paste");
  if (combined.match(/combine|consolidat|compile/)) steps.push("Combine multiple inputs into one structured place");
  if (combined.match(/summar|report|deck|powerpoint/)) steps.push("Draft a first summary or report");
  if (combined.match(/search|look up|find/)) steps.push("Search and surface the relevant information");
  if (combined.match(/schedule|book/)) steps.push("Handle routine scheduling or booking steps");
  if (steps.length === 0) steps.push("Handle the repetitive, rules-based parts of the process");
  return steps.slice(0, 5);
}

function buildHumanSteps(input: AnalyseTaskInput): string[] {
  const steps = ["Making judgement calls", "Approving the final output"];
  if (input.sensitive === "Yes" || input.sensitive === "Not sure") steps.unshift("Checking sensitive or confidential information");
  return steps;
}

function buildWorkflow(automatableSteps: string[]): AnalysisResult["suggestedWorkflow"] {
  const middle = automatableSteps.slice(0, 2).map((s, i) => ({ step: i + 2, label: i === 0 ? "Organise" : "AI Draft", description: s }));
  return [
    { step: 1, label: "Collect", description: "Automatically gather the inputs this task depends on." },
    ...middle,
    { step: middle.length + 2, label: "Human Review", description: "You review and approve the final output." },
  ];
}
