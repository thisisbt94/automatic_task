import { useEffect, useState } from "react";
import { getInsights, getInsightsFeed } from "../lib/api";

interface InsightsData {
  eventTitle: string;
  totalSubmissions: number;
  categories: { category: string; count: number; pct: number }[];
  automationPotential: { potential: string; count: number; pct: number }[];
  note: string;
}

const POTENTIAL_COLOR: Record<string, string> = { High: "#1E9E6B", Medium: "#C98A17", Low: "#C64A3D" };
const BAR_COLORS = ["#3B5BFF", "#5C7CFA", "#8AA0FF", "#C98A17", "#1E9E6B", "#C64A3D", "#8B8B99"];

export default function Insights() {
  const [data, setData] = useState<InsightsData | null>(null);
  const [feed, setFeed] = useState<{ category: string; createdAt: string; task: string | null }[]>([]);
  const [err, setErr] = useState("");

  useEffect(() => {
    const load = () => {
      getInsights().then(setData).catch((e) => setErr(e.message));
      getInsightsFeed().then((r) => setFeed(r.feed)).catch(() => {});
    };
    load();
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, []);

  if (err) {
    return (
      <div className="min-h-screen flex items-center justify-center text-center px-6">
        <p className="text-ink/60">{err}</p>
      </div>
    );
  }
  if (!data) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-10 h-10 rounded-full border-4 border-ink/10 border-t-brand-500 animate-spin" />
      </div>
    );
  }

  const maxCat = Math.max(1, ...data.categories.map((c) => c.pct));

  return (
    <div className="min-h-screen bg-ink text-paper px-10 py-10">
      <p className="uppercase tracking-[0.25em] text-brand-400 font-display font-600 text-sm">LEAD 2026 · Live insight</p>
      <h1 className="font-display font-700 text-4xl md:text-5xl mt-2">WHAT OUR LEADERS WANT AI TO HELP WITH</h1>
      <p className="font-display text-3xl mt-4 text-paper/70">{data.totalSubmissions} tasks submitted</p>

      <div className="grid lg:grid-cols-3 gap-8 mt-10">
        <div className="lg:col-span-2 bg-paper/5 rounded-xl2 p-8">
          <p className="font-display font-600 text-lg mb-6 text-paper/80">TOP OPPORTUNITIES</p>
          <div className="space-y-4">
            {data.categories.map((c, i) => (
              <div key={c.category}>
                <div className="flex justify-between text-sm mb-1.5">
                  <span className="font-display font-600">{c.category}</span>
                  <span className="text-paper/60">{c.pct}%</span>
                </div>
                <div className="h-4 rounded-full bg-paper/10 overflow-hidden">
                  <div
                    className="h-full rounded-full animate-grow-bar"
                    style={{ width: `${(c.pct / maxCat) * 100}%`, backgroundColor: BAR_COLORS[i % BAR_COLORS.length] }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-paper/5 rounded-xl2 p-8">
          <p className="font-display font-600 text-lg mb-6 text-paper/80">AUTOMATION POTENTIAL</p>
          <div className="space-y-5">
            {data.automationPotential.map((p) => (
              <div key={p.potential}>
                <div className="flex justify-between text-sm mb-1.5">
                  <span className="font-display font-600">{p.potential}</span>
                  <span className="text-paper/60">{p.pct}%</span>
                </div>
                <div className="h-4 rounded-full bg-paper/10 overflow-hidden">
                  <div className="h-full rounded-full animate-grow-bar" style={{ width: `${p.pct}%`, backgroundColor: POTENTIAL_COLOR[p.potential] }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {feed.length > 0 && (
        <div className="mt-10">
          <p className="font-display font-600 text-lg mb-4 text-paper/80">JUST SUBMITTED</p>
          <div className="flex gap-4 overflow-x-auto scrollbar-none pb-2">
            {feed.map((f, i) => (
              <div key={i} className="min-w-[260px] bg-paper/5 rounded-xl2 p-5 shrink-0">
                <p className="text-xs uppercase tracking-wide text-brand-400 font-display font-600">{f.category}</p>
                <p className="text-sm text-paper/80 mt-2">{f.task ?? "A task involving sensitive information"}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      <p className="text-xs text-paper/30 mt-10 max-w-2xl">{data.note}</p>
    </div>
  );
}
