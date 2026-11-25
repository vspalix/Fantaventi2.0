import { readFileSync } from "node:fs";

function readLocalSecret() {
  if (process.env.CRON_SECRET) return process.env.CRON_SECRET.trim();
  const raw = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
  const line = raw.split(/\r?\n/).find((item) => item.startsWith("CRON_SECRET="));
  if (!line) throw new Error("Manca CRON_SECRET in .env.local.");
  return line.slice("CRON_SECRET=".length).trim();
}

const secret = readLocalSecret();
const base = (process.env.APP_URL || "https://fantaventi2-0.vercel.app").replace(/\/$/, "");
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
