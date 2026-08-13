import app from "./_app";

// Files prefixed with "_" (e.g. _app.ts, _db.ts) are not deployed as
// their own routes by Vercel — only this catch-all file is. Express
// apps are callable as (req, res), which is exactly the signature
// Vercel's Node runtime expects, so no adapter library is needed.
export default app;
