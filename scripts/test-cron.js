import { readFileSync } from "node:fs";

function readLocalSecret() {
  if (process.env.CRON_SECRET) return process.env.CRON_SECRET.trim();
  const raw = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
  const line = raw.split(/\r?\n/).find((item) => item.startsWith("CRON_SECRET="));
  if (!line) throw new Error("Manca CRON_SECRET in .env.local.");
  return line.slice("CRON_SECRET=".length).trim();
}

const base = (process.env.APP_URL || "https://fantaventi2-0.vercel.app").replace(/\/$/, "");
// Svegliare il sito vero fa partire lavori e notifiche veri: serve la chiave aperta apposta.
const local = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(base);
if (!local && process.env.ALLOW_REAL_NOTIFICATIONS !== "true") {
  console.log(`[finto] Nessuna chiamata a ${base}. Per svegliare davvero il sito imposta ALLOW_REAL_NOTIFICATIONS=true.`);
  process.exit(0);
}
const secret = readLocalSecret();
const paths = ["/api/cron/sync-match-votes", "/api/cron/sync-availability"];
let failed = false;

for (const path of paths) {
  const response = await fetch(`${base}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${secret}` },
  });
  const body = await response.text();
  console.log(`${response.status} ${response.statusText} ${path}`);
  console.log(body);
  if (response.status !== 200) failed = true;
}

if (failed) process.exitCode = 1;
