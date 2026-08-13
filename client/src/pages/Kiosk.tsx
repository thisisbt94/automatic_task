import { useEffect, useRef, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import {
  analyseTask,
  AnalysisResult,
  ClarificationTurn,
  createSession,
  emailResult,
  Frequency,
  Sensitive,
  TimeSpent,
} from "../lib/api";
import ScoreGauge from "../components/ScoreGauge";
import WorkflowDiagram from "../components/WorkflowDiagram";
import { useInactivityReset } from "../lib/useInactivityReset";

type Step = "welcome" | "describe" | "thinking" | "clarify" | "result" | "error";

const EXAMPLES = [
  "Preparing the same report every week",
  "Following up with people for updates",
  "Turning meeting notes into actions",
  "Copying information between systems",
  "Answering similar customer questions",
];

const FREQUENCIES: Frequency[] = ["Daily", "Weekly", "Monthly", "Occasionally"];
const TIME_OPTIONS: TimeSpent[] = ["<15 minutes", "15–30 minutes", "30–60 minutes", "1–3 hours", "3+ hours"];

const POTENTIAL_COPY: Record<string, string> = {
  High: "YES — A LOT OF THIS COULD PROBABLY BE AUTOMATED",
  Medium: "PARTS OF THIS COULD BE AUTOMATED",
  Low: "THIS NEEDS MORE HUMAN JUDGEMENT",
};

export default function Kiosk({ kioskInactivitySeconds = 60 }: { kioskInactivitySeconds?: number }) {
  const [step, setStep] = useState<Step>("welcome");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [task, setTask] = useState("");
  const [frequency, setFrequency] = useState<Frequency | null>(null);
  const [timeSpent, setTimeSpent] = useState<TimeSpent | null>(null);
  const [sensitive, setSensitive] = useState<Sensitive | null>(null);
  const [clarificationHistory, setClarificationHistory] = useState<ClarificationTurn[]>([]);
  const [pendingQuestion, setPendingQuestion] = useState("");
  const [clarifyAnswer, setClarifyAnswer] = useState("");
  const [resultId, setResultId] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [errorMsg, setErrorMsg] = useState("");
  const [emailValue, setEmailValue] = useState("");
  const [emailSent, setEmailSent] = useState(false);

  const { active, secondsLeft, arm, disarm } = useInactivityReset(resetAll);

  useEffect(() => {
    if (step === "result") arm(kioskInactivitySeconds);
    else disarm();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  function resetAll() {
    setStep("welcome");
    setTask("");
    setFrequency(null);
    setTimeSpent(null);
    setSensitive(null);
    setClarificationHistory([]);
    setPendingQuestion("");
    setClarifyAnswer("");
    setResultId(null);
    setAnalysis(null);
    setErrorMsg("");
    setEmailValue("");
    setEmailSent(false);
  }

  async function ensureSession() {
    if (sessionId) return sessionId;
    const { sessionId: id } = await createSession(navigator.userAgent.slice(0, 60));
    setSessionId(id);
    return id;
  }

  async function submitTask() {
    if (!frequency || !timeSpent || !sensitive) return;
    setStep("thinking");
    setErrorMsg("");
    try {
      const sid = await ensureSession();
      const res = await analyseTask({ sessionId: sid, task, frequency, timeSpent, sensitive, clarificationHistory });
      if (res.needsClarification) {
        setPendingQuestion(res.question);
        setStep("clarify");
      } else {
        setResultId(res.resultId);
        setAnalysis(res.analysis);
        setStep("result");
      }
    } catch (err: any) {
      setErrorMsg(err?.message || "Something went wrong. Please try again.");
      setStep("error");
    }
  }

  async function submitClarification() {
    if (!clarifyAnswer.trim() || !frequency || !timeSpent || !sensitive) return;
    const nextHistory = [...clarificationHistory, { question: pendingQuestion, answer: clarifyAnswer.trim() }];
    setClarificationHistory(nextHistory);
    setClarifyAnswer("");
    setStep("thinking");
    try {
      const sid = await ensureSession();
      const res = await analyseTask({ sessionId: sid, task, frequency, timeSpent, sensitive, clarificationHistory: nextHistory });
      if (res.needsClarification) {
        setPendingQuestion(res.question);
        setStep("clarify");
      } else {
        setResultId(res.resultId);
        setAnalysis(res.analysis);
        setStep("result");
      }
    } catch (err: any) {
      setErrorMsg(err?.message || "Something went wrong. Please try again.");
      setStep("error");
    }
  }

  async function sendEmail() {
    if (!resultId || !emailValue.trim()) return;
    try {
      await emailResult(resultId, emailValue.trim());
      setEmailSent(true);
    } catch {
      setEmailSent(false);
    }
  }

  return (
    <div className="h-screen w-screen flex flex-col overflow-hidden">
      {step === "welcome" && <Welcome onStart={() => setStep("describe")} />}
      {step === "describe" && (
        <DescribeTask
          task={task}
          setTask={setTask}
          frequency={frequency}
          setFrequency={setFrequency}
          timeSpent={timeSpent}
          setTimeSpent={setTimeSpent}
          sensitive={sensitive}
          setSensitive={setSensitive}
          onBack={resetAll}
          onSubmit={submitTask}
        />
      )}
      {step === "thinking" && <Thinking />}
      {step === "clarify" && (
        <Clarify question={pendingQuestion} answer={clarifyAnswer} setAnswer={setClarifyAnswer} onSubmit={submitClarification} />
      )}
      {step === "error" && <ErrorScreen message={errorMsg} onRetry={() => setStep("describe")} onReset={resetAll} />}
      {step === "result" && analysis && resultId && (
        <ResultScreen
          resultId={resultId}
          analysis={analysis}
          secondsLeft={secondsLeft}
          active={active}
          emailValue={emailValue}
          setEmailValue={setEmailValue}
          emailSent={emailSent}
          onSendEmail={sendEmail}
          onDone={resetAll}
        />
      )}
    </div>
  );
}

// ── Step 1 — Welcome ─────────────────────────────────────────────

function Welcome({ onStart }: { onStart: () => void }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center px-8 text-center animate-fade-up">
      <p className="uppercase tracking-[0.2em] text-brand-500 font-display font-600 text-sm mb-6">LEAD 2026 · AI Booth</p>
      <h1 className="font-display font-700 text-5xl md:text-6xl leading-[1.05] max-w-3xl">
        CAN MY TASK
        <br />
        BE AUTOMATED?
      </h1>
      <p className="mt-6 text-lg md:text-xl text-ink/60 max-w-xl">Tell us one repetitive task you wish took less time.</p>
      <button
        onClick={onStart}
        className="mt-10 bg-ink text-paper font-display font-600 text-lg px-10 py-5 rounded-xl2 active:scale-[0.98] transition-transform shadow-[0_8px_0_0_rgba(18,19,26,0.15)]"
      >
        CHECK MY TASK
      </button>
      <div className="mt-14 flex flex-wrap justify-center gap-2 max-w-2xl">
        {EXAMPLES.map((e) => (
          <span key={e} className="text-sm text-ink/50 bg-ink/5 rounded-full px-4 py-2">
            "{e}"
          </span>
        ))}
      </div>
    </div>
  );
}

// ── Step 2 — Describe the task ────────────────────────────────────

function DescribeTask(props: {
  task: string;
  setTask: (v: string) => void;
  frequency: Frequency | null;
  setFrequency: (v: Frequency) => void;
  timeSpent: TimeSpent | null;
  setTimeSpent: (v: TimeSpent) => void;
  sensitive: Sensitive | null;
  setSensitive: (v: Sensitive) => void;
  onBack: () => void;
  onSubmit: () => void;
}) {
  const { task, setTask, frequency, setFrequency, timeSpent, setTimeSpent, sensitive, setSensitive, onBack, onSubmit } = props;
  const canSubmit = task.trim().length > 3 && !!frequency && !!timeSpent && !!sensitive;
  const [listening, setListening] = useState(false);
  const recognitionRef = useRef<any>(null);

  function toggleVoice() {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) return;
    if (listening) {
      recognitionRef.current?.stop();
      return;
    }
    const rec = new SR();
    rec.lang = "en-US";
    rec.continuous = false;
    rec.interimResults = false;
    rec.onresult = (e: any) => {
      const text = Array.from(e.results).map((r: any) => r[0].transcript).join(" ");
      setTask((task ? task + " " : "") + text);
    };
    rec.onend = () => setListening(false);
    recognitionRef.current = rec;
    rec.start();
    setListening(true);
  }

  return (
    <div className="flex-1 flex flex-col px-8 py-10 max-w-2xl mx-auto w-full overflow-y-auto scrollbar-none animate-fade-up">
      <button onClick={onBack} className="text-ink/40 text-sm self-start mb-6">
        ← Start over
      </button>
      <h2 className="font-display font-700 text-3xl mb-4">What do you repeatedly have to do?</h2>
      <div className="relative">
        <textarea
          value={task}
          onChange={(e) => setTask(e.target.value)}
          rows={4}
          placeholder="For example: Every Monday I collect updates from five teams and combine everything into a PowerPoint report."
          className="w-full rounded-xl2 border border-ink/10 bg-white p-5 text-lg leading-relaxed focus:outline-none focus:ring-2 focus:ring-brand-400 resize-none"
        />
        {typeof window !== "undefined" && ((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition) && (
          <button
            onClick={toggleVoice}
            className={`absolute bottom-4 right-4 w-11 h-11 rounded-full flex items-center justify-center ${
              listening ? "bg-low text-white animate-pulse-soft" : "bg-ink/5 text-ink/60"
            }`}
            aria-label="Voice input"
          >
            🎙
          </button>
        )}
      </div>

      <div className="mt-8">
        <p className="font-display font-600 mb-3">How often?</p>
        <div className="flex flex-wrap gap-2">
          {FREQUENCIES.map((f) => (
            <Pill key={f} label={f} active={frequency === f} onClick={() => setFrequency(f)} />
          ))}
        </div>
      </div>

      <div className="mt-6">
        <p className="font-display font-600 mb-3">Roughly how much time does it take each time?</p>
        <div className="flex flex-wrap gap-2">
          {TIME_OPTIONS.map((t) => (
            <Pill key={t} label={t} active={timeSpent === t} onClick={() => setTimeSpent(t)} />
          ))}
        </div>
      </div>

      <div className="mt-6">
        <p className="font-display font-600 mb-3">Does this task involve sensitive/confidential information?</p>
        <div className="flex flex-wrap gap-2">
          {(["Yes", "No", "Not sure"] as Sensitive[]).map((s) => (
            <Pill key={s} label={s} active={sensitive === s} onClick={() => setSensitive(s)} />
          ))}
        </div>
        {sensitive === "Yes" && (
          <p className="text-sm text-ink/50 mt-2">Keep your description general. You don't need to include names, figures or confidential details.</p>
        )}
      </div>

      <p className="text-xs text-ink/40 mt-8">Please don't enter passwords, personal data or highly confidential information.</p>

      <button
        disabled={!canSubmit}
        onClick={onSubmit}
        className="mt-6 mb-4 bg-ink text-paper disabled:bg-ink/20 disabled:cursor-not-allowed font-display font-600 text-lg px-10 py-5 rounded-xl2 active:scale-[0.98] transition-transform"
      >
        ANALYSE MY TASK
      </button>
    </div>
  );
}

function Pill({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`px-5 py-3 rounded-full text-sm font-display font-600 border transition-colors ${
        active ? "bg-brand-500 border-brand-500 text-white" : "bg-white border-ink/10 text-ink/70"
      }`}
    >
      {label}
    </button>
  );
}

// ── Step 3 — thinking / clarify ────────────────────────────────────

function Thinking() {
  return (
    <div className="flex-1 flex flex-col items-center justify-center px-8 text-center">
      <div className="w-16 h-16 rounded-full border-4 border-ink/10 border-t-brand-500 animate-spin" />
      <p className="mt-8 font-display font-600 text-xl animate-pulse-soft">Looking at what's actually involved…</p>
    </div>
  );
}

function Clarify({ question, answer, setAnswer, onSubmit }: { question: string; answer: string; setAnswer: (v: string) => void; onSubmit: () => void }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center px-8 max-w-xl mx-auto text-center animate-fade-up">
      <p className="uppercase tracking-[0.2em] text-brand-500 font-display font-600 text-sm mb-4">One quick question</p>
      <h2 className="font-display font-700 text-3xl mb-8">{question}</h2>
      <textarea
        value={answer}
        onChange={(e) => setAnswer(e.target.value)}
        rows={3}
        autoFocus
        className="w-full rounded-xl2 border border-ink/10 bg-white p-5 text-lg leading-relaxed focus:outline-none focus:ring-2 focus:ring-brand-400 resize-none"
      />
      <button
        disabled={!answer.trim()}
        onClick={onSubmit}
        className="mt-6 bg-ink text-paper disabled:bg-ink/20 font-display font-600 text-lg px-10 py-5 rounded-xl2 active:scale-[0.98] transition-transform"
      >
        CONTINUE
      </button>
    </div>
  );
}

function ErrorScreen({ message, onRetry, onReset }: { message: string; onRetry: () => void; onReset: () => void }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center px-8 text-center">
      <p className="font-display font-700 text-2xl text-low">We couldn't analyse that just now</p>
      <p className="mt-3 text-ink/60 max-w-md">{message}</p>
      <div className="flex gap-3 mt-8">
        <button onClick={onRetry} className="bg-ink text-paper font-display font-600 px-8 py-4 rounded-xl2">
          Try again
        </button>
        <button onClick={onReset} className="bg-ink/5 text-ink font-display font-600 px-8 py-4 rounded-xl2">
          Start over
        </button>
      </div>
    </div>
  );
}

// ── Step 4 — Result ────────────────────────────────────────────────

function ResultScreen(props: {
  resultId: string;
  analysis: AnalysisResult;
  secondsLeft: number;
  active: boolean;
  emailValue: string;
  setEmailValue: (v: string) => void;
  emailSent: boolean;
  onSendEmail: () => void;
  onDone: () => void;
}) {
  const { resultId, analysis, secondsLeft, active, emailValue, setEmailValue, emailSent, onSendEmail, onDone } = props;
  const headline = POTENTIAL_COPY[analysis.automationPotential] ?? POTENTIAL_COPY.Medium;
  const shareUrl = `${window.location.origin}/result/${resultId}`;

  return (
    <div className="flex-1 overflow-y-auto scrollbar-none px-6 md:px-10 py-8 animate-fade-up">
      <div className="max-w-3xl mx-auto">
        <p className="uppercase tracking-[0.2em] text-brand-500 font-display font-600 text-sm mb-2">{analysis.category}</p>
        <h1 className="font-display font-700 text-3xl md:text-4xl leading-tight">{headline}</h1>
        <p className="text-ink/60 mt-3 max-w-xl">{analysis.taskSummary}</p>

        <div className="mt-8 flex flex-col md:flex-row items-center gap-8 bg-white rounded-xl2 border border-ink/10 p-6">
          <ScoreGauge score={analysis.automationScore} potential={analysis.automationPotential} />
          <div>
            <p className="font-display font-700 text-xl">AUTOMATION POTENTIAL: {analysis.automationPotential.toUpperCase()}</p>
            <p className="text-ink/60 mt-2">{analysis.why}</p>
            <p className="text-ink/40 text-sm mt-2">Difficulty to set up: {analysis.difficulty}</p>
          </div>
        </div>

        <div className="grid md:grid-cols-2 gap-4 mt-6">
          <div className="bg-good/10 rounded-xl2 p-6">
            <p className="font-display font-700 mb-3">WHAT AI COULD HELP WITH</p>
            <ul className="space-y-2">
              {analysis.automatableSteps.map((s) => (
                <li key={s} className="flex gap-2 text-sm">
                  <span className="text-good font-700">✓</span>
                  <span>{s}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="bg-ink/5 rounded-xl2 p-6">
            <p className="font-display font-700 mb-3">YOU STILL CONTROL</p>
            <ul className="space-y-2">
              {analysis.humanStillNeededFor.map((s) => (
                <li key={s} className="flex gap-2 text-sm">
                  <span className="font-700">✓</span>
                  <span>{s}</span>
                </li>
              ))}
            </ul>
            <p className="text-xs text-ink/40 mt-4">AI assists. Humans remain accountable.</p>
          </div>
        </div>

        <div className="mt-8 bg-white rounded-xl2 border border-ink/10 p-6">
          <p className="font-display font-700 mb-4">A POSSIBLE WORKFLOW</p>
          <WorkflowDiagram steps={analysis.suggestedWorkflow} />
        </div>

        <div className="mt-6 bg-brand-50 rounded-xl2 p-6">
          <p className="font-display font-700 mb-2">YOUR NEXT STEP</p>
          <p className="text-ink/70">{analysis.nextStep}</p>
          <p className="text-xs text-ink/40 mt-3">{analysis.estimatedBenefit}</p>
        </div>

        <div className="mt-8 grid md:grid-cols-2 gap-4 items-start">
          <div className="bg-white rounded-xl2 border border-ink/10 p-6 flex flex-col items-center text-center">
            <p className="font-display font-700 mb-3">TAKE IT WITH YOU</p>
            <div className="bg-white p-3 rounded-lg border border-ink/10">
              <QRCodeSVG value={shareUrl} size={132} />
            </div>
            <p className="text-xs text-ink/40 mt-3 break-all">{shareUrl}</p>
          </div>
          <div className="bg-white rounded-xl2 border border-ink/10 p-6">
            <p className="font-display font-700 mb-3">EMAIL THIS TO ME (OPTIONAL)</p>
            {emailSent ? (
              <p className="text-good text-sm">Sent — check your inbox shortly.</p>
            ) : (
              <div className="flex gap-2">
                <input
                  value={emailValue}
                  onChange={(e) => setEmailValue(e.target.value)}
                  placeholder="you@company.com"
                  className="flex-1 rounded-xl border border-ink/10 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400"
                />
                <button onClick={onSendEmail} className="bg-ink text-paper text-sm font-display font-600 px-5 rounded-xl">
                  Send
                </button>
              </div>
            )}
          </div>
        </div>

        <div className="flex justify-center mt-10 mb-4">
          <button onClick={onDone} className="text-ink/40 text-sm underline">
            Done — start a new one
          </button>
        </div>

        {active && secondsLeft <= 20 && (
          <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-ink text-paper px-6 py-3 rounded-full text-sm font-display font-600 shadow-lg">
            Finished? Scan your result before this screen resets in {secondsLeft}s
          </div>
        )}
      </div>
    </div>
  );
}
