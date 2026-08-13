const COLORS: Record<string, string> = {
  High: "#1E9E6B",
  Medium: "#C98A17",
  Low: "#C64A3D",
};

export default function ScoreGauge({ score, potential }: { score: number; potential: "High" | "Medium" | "Low" }) {
  const radius = 78;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - score / 100);
  const color = COLORS[potential] ?? COLORS.Medium;

  return (
    <div className="relative w-[200px] h-[200px] shrink-0">
      <svg viewBox="0 0 200 200" className="w-full h-full -rotate-90">
        <circle cx="100" cy="100" r={radius} fill="none" stroke="#E7E5E0" strokeWidth="16" />
        <circle
          cx="100"
          cy="100"
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth="16"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          style={{ transition: "stroke-dashoffset 1s cubic-bezier(0.16,1,0.3,1)" }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="font-display text-5xl font-700" style={{ color }}>
          {score}
        </span>
        <span className="text-xs text-ink/50 -mt-1">/ 100</span>
      </div>
    </div>
  );
}
