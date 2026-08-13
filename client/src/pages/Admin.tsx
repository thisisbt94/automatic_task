import { useEffect, useState } from "react";
import { adminExportCsvUrl, adminStatus, adminUpdateConfig } from "../lib/api";

export default function Admin() {
  const [password, setPassword] = useState(sessionStorage.getItem("boothAdminPw") || "");
  const [authed, setAuthed] = useState(false);
  const [status, setStatus] = useState<any>(null);
  const [err, setErr] = useState("");
  const [eventTitle, setEventTitle] = useState("");
  const [dashboardEnabled, setDashboardEnabled] = useState(true);
  const [retentionDays, setRetentionDays] = useState(90);
  const [savedMsg, setSavedMsg] = useState("");

  async function login(pw: string) {
    try {
      const s = await adminStatus(pw);
      setStatus(s);
      setEventTitle(s.config.eventTitle);
      setDashboardEnabled(s.config.dashboardEnabled);
      setRetentionDays(s.config.retentionDays);
      setAuthed(true);
      setErr("");
      sessionStorage.setItem("boothAdminPw", pw);
    } catch (e: any) {
      setErr(e.message || "Wrong password");
      setAuthed(false);
    }
  }

  useEffect(() => {
    if (password) login(password);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!authed) return;
    const t = setInterval(() => login(password), 20000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authed]);

  async function saveConfig() {
    await adminUpdateConfig(password, { eventTitle, dashboardEnabled, retentionDays });
    setSavedMsg("Saved.");
    setTimeout(() => setSavedMsg(""), 2000);
    login(password);
  }

  if (!authed) {
    return (
      <div className="min-h-screen flex items-center justify-center px-6">
        <div className="max-w-sm w-full">
          <h1 className="font-display font-700 text-2xl mb-4">Booth admin</h1>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && login(password)}
            placeholder="Admin password"
            className="w-full rounded-xl border border-ink/10 px-4 py-3 focus:outline-none focus:ring-2 focus:ring-brand-400"
          />
          {err && <p className="text-low text-sm mt-2">{err}</p>}
          <button onClick={() => login(password)} className="mt-4 bg-ink text-paper font-display font-600 px-6 py-3 rounded-xl w-full">
            Enter
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-paper px-6 md:px-10 py-10">
      <div className="max-w-4xl mx-auto">
        <h1 className="font-display font-700 text-3xl mb-8">Booth admin</h1>

        <div className="grid md:grid-cols-3 gap-4">
          <StatCard label="ILMU status" value={status.ilmuStatus.ok ? "OK" : "Unavailable"} tone={status.ilmuStatus.ok ? "good" : "low"} sub={`${status.ilmuStatus.provider}${status.ilmuStatus.demoMode ? " (demo mode)" : ""}`} />
          <StatCard label="Submissions today" value={String(status.submissionsToday)} />
          <StatCard label="Total submissions" value={String(status.totalSubmissions)} />
        </div>

        <div className="mt-8 bg-white rounded-xl2 border border-ink/10 p-6">
          <p className="font-display font-700 mb-4">Top categories</p>
          <div className="space-y-2">
            {status.topCategories.map((c: any) => (
              <div key={c.category} className="flex justify-between text-sm border-b border-ink/5 py-2">
                <span>{c.category}</span>
                <span className="text-ink/50">{c.n}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-6 bg-white rounded-xl2 border border-ink/10 p-6">
          <p className="font-display font-700 mb-4">Recent errors</p>
          {status.recentErrors.length === 0 ? (
            <p className="text-sm text-ink/40">None logged since the server started.</p>
          ) : (
            <div className="space-y-2 max-h-56 overflow-y-auto">
              {status.recentErrors.map((e: any, i: number) => (
                <div key={i} className="text-sm">
                  <span className="text-ink/40">{new Date(e.at).toLocaleTimeString()} — </span>
                  <span className="text-low">{e.message}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="mt-6 bg-white rounded-xl2 border border-ink/10 p-6">
          <p className="font-display font-700 mb-4">Active tablets</p>
          <p className="text-sm text-ink/40">Not tracked in this prototype — each tablet is just a browser tab open to the kiosk URL. A device-registration table can be added if per-tablet monitoring is needed.</p>
        </div>

        <div className="mt-6 bg-white rounded-xl2 border border-ink/10 p-6">
          <p className="font-display font-700 mb-4">Event configuration</p>
          <label className="text-sm text-ink/60">Event title</label>
          <input value={eventTitle} onChange={(e) => setEventTitle(e.target.value)} className="w-full rounded-xl border border-ink/10 px-4 py-3 mt-1 mb-4" />

          <label className="text-sm text-ink/60">Retention period (days)</label>
          <input
            type="number"
            value={retentionDays}
            onChange={(e) => setRetentionDays(Number(e.target.value))}
            className="w-full rounded-xl border border-ink/10 px-4 py-3 mt-1 mb-4"
          />

          <label className="flex items-center gap-2 mb-4">
            <input type="checkbox" checked={dashboardEnabled} onChange={(e) => setDashboardEnabled(e.target.checked)} />
            <span className="text-sm">Dashboard (/insights) turned on</span>
          </label>

          <div className="flex items-center gap-3">
            <button onClick={saveConfig} className="bg-ink text-paper font-display font-600 px-6 py-3 rounded-xl">
              Save changes
            </button>
            {savedMsg && <span className="text-good text-sm">{savedMsg}</span>}
          </div>
        </div>

        <div className="mt-6 flex flex-wrap gap-3">
          <a href={adminExportCsvUrl(password)} className="bg-ink/5 font-display font-600 px-6 py-3 rounded-xl text-center">
            Export anonymised CSV
          </a>
          <button
            onClick={() => alert("Each tablet resets itself automatically after the inactivity countdown — no manual reset needed for a single tab. Refresh a tablet's browser if it's stuck.")}
            className="bg-ink/5 font-display font-600 px-6 py-3 rounded-xl"
          >
            Reset kiosk
          </button>
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "good" | "low" }) {
  return (
    <div className="bg-white rounded-xl2 border border-ink/10 p-6">
      <p className="text-sm text-ink/50">{label}</p>
      <p className={`font-display font-700 text-3xl mt-1 ${tone === "good" ? "text-good" : tone === "low" ? "text-low" : ""}`}>{value}</p>
      {sub && <p className="text-xs text-ink/40 mt-1">{sub}</p>}
    </div>
  );
}
