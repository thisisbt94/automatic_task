# Can My Task Be Automated?

A working conference-booth app for LEAD 2026. An attendee describes one
repetitive task, answers three quick taps, and gets a real analysis of
what could be automated, what still needs a human, and what to do
next — plus a QR code to take it with them and a live shared-display
dashboard aggregating everyone's answers.

This is a real, running application, not a mock-up: the frontend calls
a real backend API, which calls a real database and (when configured)
a real AI backend. Nothing here fakes a result — if the AI backend is
down, the app says so instead of inventing an answer.

## What's in here

```
booth/
  server/     Express + TypeScript API, SQLite database, ILMU/n8n integration
  client/     React + TypeScript + Tailwind frontend (kiosk, /insights, /admin, /result/:id)
```

## 1. Installation

Requires Node.js 18+.

```bash
cd server && npm install
cd ../client && npm install
```

## 2. Environment variables

```bash
cd server
cp .env.example .env
```

Open `.env` and set:

| Variable | Purpose |
|---|---|
| `DEMO_MODE` | `true` = uses a local, clearly-labelled rule-based analyser, no external calls. `false` = calls the configured `AI_PROVIDER`. **Set to `false` for the live event.** |
| `AI_PROVIDER` | `ilmu` or `n8n` — which backend handles analysis when `DEMO_MODE=false`. |
| `N8N_AUTOMATION_WEBHOOK_URL`, `N8N_SHARED_SECRET` | Option A — see below. |
| `ILMU_API_URL`, `ILMU_API_KEY`, `ILMU_MODEL` | Option B — see below. |
| `ADMIN_PASSWORD` | Password for `/admin`. Change this before the event. |
| `EVENT_TITLE`, `KIOSK_INACTIVITY_SECONDS`, `DATA_RETENTION_DAYS` | Starting values; all editable live from `/admin`. |
| `DB_PATH` | Where the SQLite file lives. Defaults to `./data/booth.sqlite`. |

## 3. ILMU integration (Option B — recommended, matches ILMU's known API)

ILMU is OpenAI-compatible. `server/src/ilmu.ts` posts to
`{ILMU_API_URL}/chat/completions` with a bearer token, using the model
id `ilmu-v3.1` (already the default — this is ILMU's real model
identifier, not the n8n node's display name "nemo-super", which is
not a valid API value).

```
ILMU_API_URL=https://api.ilmu.ai/v1
ILMU_API_KEY=<key>
ILMU_MODEL=ilmu-v3.1
AI_PROVIDER=ilmu
DEMO_MODE=false
```

The system prompt enforces: never claim a whole job is automatable,
break tasks into steps, be conservative, ask at most one clarifying
question at a time (never more than 2 rounds total), flag privacy
considerations, and respond in the exact JSON schema the frontend
expects. See `SYSTEM_PROMPT` in `server/src/ilmu.ts` if you want to
tune it.

`ILMU_API_KEY` is read server-side only and is never sent to the
browser.

## 4. n8n integration (Option A — alternative)

If you'd rather route through an n8n workflow instead of calling ILMU
directly:

```
AI_PROVIDER=n8n
DEMO_MODE=false
N8N_AUTOMATION_WEBHOOK_URL=https://btym-wflow.shop/webhook/<path>
N8N_SHARED_SECRET=<your x-agent-token value>
```

The server POSTs:

```json
{
  "action": "analyse-task",
  "experience": "automation-booth",
  "sessionId": "...",
  "task": "...",
  "frequency": "...",
  "timeSpent": "...",
  "sensitive": "...",
  "clarificationHistory": []
}
```

with header `x-agent-token: <N8N_SHARED_SECRET>`, and expects back:

```json
{ "success": true, "analysis": { ...structured JSON... } }
```

or, when the model wants more information:

```json
{ "success": true, "analysis": { "needsClarification": true, "question": "..." } }
```

Build the n8n workflow so its final node returns exactly that shape —
the easiest path is an ILMU/HTTP node inside n8n using the same system
prompt in `server/src/ilmu.ts`.

## 5. Database

SQLite via `better-sqlite3`, chosen for a zero-install prototype — one
file, no server to run, works offline at a booth with patchy wifi.
Tables match the brief 1:1: `sessions`, `task_submissions`,
`analysis_results`, `categories`, `event_configuration`.

No attendee login. Every submission gets a random session id and a
short public `result_id` (used in the QR/`/result/:id` URL) — neither
is tied to a real identity.

**Swapping in Postgres/Supabase:** the schema in `server/src/db.ts` is
plain SQL and translates directly — swap `better-sqlite3` for a `pg`
client (or the Supabase JS client) and adjust the few
SQLite-specific bits (`AUTOINCREMENT`→`SERIAL`, `db.prepare(...).get/all/run`
→ your client's query calls). Nothing else in the app needs to change,
since all access goes through `server/src/db.ts`.

## 6. Running it

Two processes, two terminals:

```bash
# Terminal 1 — API
cd server
npm run dev        # http://localhost:4000

# Terminal 2 — frontend
cd client
npm run dev         # http://localhost:5173, proxies /api to :4000
```

Optional: seed the `/insights` dashboard with synthetic demo data so
it's not empty while rehearsing:

```bash
cd server && npm run seed:demo
```

For a real deployment build:

```bash
cd server && npm run build && npm start
cd client && npm run build && npm run preview   # or serve dist/ from any static host / nginx
```

## 7. Kiosk deployment (tablets + shared display)

- Each tablet: open the frontend URL at `/` in full-screen/kiosk
  browser mode (e.g. Chrome `--kiosk`, or a kiosk-lock app like Fully
  Kiosk Browser on Android). No login needed.
- After a result is shown, a 60-second (configurable) inactivity
  countdown starts. Any tap resets it. At zero, the tablet returns to
  the welcome screen automatically — see `useInactivityReset` in
  `client/src/lib/useInactivityReset.ts`.
- Large shared display: open `/insights` in full-screen mode. It
  polls every 15 seconds — no interaction needed.
- Recommended: a dumb power-cycle/refresh schedule overnight (e.g. via
  the kiosk app's own scheduler) as a safety net on top of the
  in-app reset.

## 8. QR result pages

Each analysis gets a 6-character `result_id`. The result screen shows
a QR code encoding `<your-domain>/result/<result_id>`, which opens
`client/src/pages/ResultShare.tsx` — a standalone page (no kiosk
chrome) showing that attendee's own analysis. Works on any phone
browser, no app required.

## 9. Insights display setup

`/insights` shows only aggregated, anonymous counts — never raw task
text for anything flagged sensitive, and the code enforces that
server-side (`server/src/index.ts`, `/api/insights/feed`), not just in
the UI. Toggle it on/off from `/admin` (`event_configuration.dashboard_enabled`)
if you need to take it down mid-event without redeploying.

## 10. Testing procedure before the event

1. `DEMO_MODE=true`, run both servers, walk the full flow at `/`
   end-to-end on an actual tablet: welcome → describe → (maybe)
   clarify → result → scan the QR on your phone → confirm
   `/result/:id` loads.
2. Try a deliberately vague input ("my inbox damn messy") — confirm it
   asks a clarifying question instead of guessing, and that it stops
   asking after 2 rounds.
3. Try marking "sensitive information: Yes" — confirm the extra
   privacy note appears, and that the item shows up on `/insights`'
   live feed with `task: null`.
4. Seed demo data (`npm run seed:demo`), open `/insights` on the
   intended display resolution, confirm it's readable from booth
   distance.
5. Set `ADMIN_PASSWORD`, open `/admin`, confirm status/export/config
   all work.
6. Set `DEMO_MODE=false` with real `ILMU_API_KEY`, repeat step 1–3
   against the live model. Then pull the network cable / rotate the
   key to confirm the app shows an honest error screen instead of a
   fabricated result (`server/src/ilmu.ts` → `ServiceUnavailableError`
   → the frontend's `ErrorScreen`).
7. Load-test lightly: `/insights` polling + several tablets submitting
   concurrently — SQLite with WAL mode (already enabled) handles this
   fine at booth scale (dozens of concurrent writers), but if you
   expect sustained heavy concurrency, move to Postgres/Supabase (see
   §5).

## 11. Production deployment considerations

- **Secrets:** `ILMU_API_KEY`, `N8N_SHARED_SECRET`, `ADMIN_PASSWORD`
  are read server-side only from environment variables — never commit
  `.env`, never let them reach the client bundle.
- **HTTPS:** put the API behind HTTPS (reverse proxy / hosting
  platform) before the event — tablets and phones scanning QR codes
  should not be on plain HTTP.
- **CORS:** currently wide-open (`cors()` with no options) since
  frontend and backend are expected to share an origin or a trusted
  proxy at the booth. Lock `origin` down if you deploy them on
  different domains.
- **Backups:** the SQLite file at `DB_PATH` is the whole dataset —
  back it up periodically during the event (e.g. hourly copy) in case
  a tablet or the host machine crashes.
- **Data retention:** `event_configuration.retention_days` is stored
  and editable from `/admin`, but no automatic purge job exists yet —
  add a scheduled task calling a delete query if you need enforced
  retention post-event rather than a manual one.
- **Rate/abuse limits:** none implemented — fine for a staffed booth,
  add basic rate limiting (`express-rate-limit`) before exposing the
  API publicly beyond the booth network.
- **Scaling the AI call:** each analysis is one LLM call
  (temperature 0.3, ~900 max tokens) — at ~1,000 attendees this is a
  modest, bounded cost; confirm your ILMU/n8n rate limits can handle
  booth peak concurrency (several tablets submitting within the same
  minute).

## Design notes

- No jargon in attendee-facing copy (no "API", "RPA", "LLM",
  "orchestration", "agentic", "vector database" anywhere in `client/`)
  — all of that lives only in this README and code comments.
- `DEMO_MODE` heuristic (`server/src/ilmu.ts` → `heuristicAnalyse`) is
  a transparent stand-in for rehearsal only; every stored/returned
  result is tagged `source: "demo"` so it's never confused with a real
  ILMU/n8n analysis in the database or the admin panel.
- Visual language deliberately avoids a chat-window feel — no message
  bubbles, one clear question at a time, big tappable pills instead of
  free-text where possible.
