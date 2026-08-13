import { WorkflowStep } from "../lib/api";

export default function WorkflowDiagram({ steps }: { steps: WorkflowStep[] }) {
  return (
    <div className="flex flex-col gap-3">
      {steps.map((s, i) => (
        <div key={s.step} className="flex items-start gap-4 animate-fade-up" style={{ animationDelay: `${i * 90}ms` }}>
          <div className="flex flex-col items-center">
            <div
              className={`w-11 h-11 rounded-full flex items-center justify-center font-display font-600 text-sm shrink-0 ${
                s.label === "Human Review" ? "bg-ink text-paper" : "bg-brand-500 text-white"
              }`}
            >
              {s.step}
            </div>
            {i < steps.length - 1 && <div className="w-px flex-1 bg-ink/15 my-1 min-h-[24px]" />}
          </div>
          <div className="pb-4">
            <p className="font-display font-600 text-base">{s.label}</p>
            <p className="text-ink/60 text-sm mt-0.5">{s.description}</p>
          </div>
        </div>
      ))}
    </div>
  );
}
