import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { getResult, AnalysisResult } from "../lib/api";
import ScoreGauge from "../components/ScoreGauge";
import WorkflowDiagram from "../components/WorkflowDiagram";

const POTENTIAL_COPY: Record<string, string> = {
  High: "YES — A LOT OF THIS COULD PROBABLY BE AUTOMATED",
  Medium: "PARTS OF THIS COULD BE AUTOMATED",
  Low: "THIS NEEDS MORE HUMAN JUDGEMENT",
};

export default function ResultShare() {
  const { resultId } = useParams();
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [task, setTask] = useState("");
  const [status, setStatus] = useState<"loading" | "ok" | "notfound">("loading");

  useEffect(() => {
    if (!resultId) return;
    getResult(resultId)
      .then((r) => {
        setAnalysis(r.analysis);
        setTask(r.task);
        setStatus("ok");
      })
      .catch(() => setStatus("notfound"));
  }, [resultId]);

  if (status === "loading") {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-10 h-10 rounded-full border-4 border-ink/10 border-t-brand-500 animate-spin" />
      </div>
    );
  }

  if (status === "notfound" || !analysis) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-6 text-center">
        <p className="font-display font-700 text-2xl">Result not found</p>
        <p className="text-ink/60 mt-2">It may have expired, or the code wasn't scanned correctly.</p>
        <Link to="/" className="mt-6 text-brand-500 underline">
          Back to the booth
        </Link>
      </div>
    );
  }

  const headline = POTENTIAL_COPY[analysis.automationPotential] ?? POTENTIAL_COPY.Medium;

  return (
    <div className="min-h-screen bg-paper px-5 py-10 md:py-16">
      <div className="max-w-2xl mx-auto">
        <p className="uppercase tracking-[0.2em] text-brand-500 font-display font-600 text-sm mb-2">{analysis.category}</p>
        <h1 className="font-display font-700 text-3xl leading-tight">{headline}</h1>
        <p className="text-ink/60 mt-3">{task}</p>

        <div className="mt-8 flex flex-col sm:flex-row items-center gap-6 bg-white rounded-xl2 border border-ink/10 p-6">
          <ScoreGauge score={analysis.automationScore} potential={analysis.automationPotential} />
          <div>
            <p className="font-display font-700 text-xl">AUTOMATION POTENTIAL: {analysis.automationPotential.toUpperCase()}</p>
            <p className="text-ink/60 mt-2">{analysis.why}</p>
          </div>
        </div>

        <div className="grid sm:grid-cols-2 gap-4 mt-6">
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
          </div>
        </div>

        <div className="mt-6 bg-white rounded-xl2 border border-ink/10 p-6">
          <p className="font-display font-700 mb-4">A POSSIBLE WORKFLOW</p>
          <WorkflowDiagram steps={analysis.suggestedWorkflow} />
        </div>

        <div className="mt-6 bg-brand-50 rounded-xl2 p-6">
          <p className="font-display font-700 mb-2">YOUR NEXT STEP</p>
          <p className="text-ink/70">{analysis.nextStep}</p>
        </div>

        <Link to="/" className="block text-center mt-10 text-ink/40 text-sm underline">
          Check another task at the booth
        </Link>
      </div>
    </div>
  );
}
