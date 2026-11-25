import { backfillEarlyWeeks } from "@/lib/server/backfill-early-weeks";

async function main() {
  const from = Number(process.argv[2] ?? 1);
  const to = Number(process.argv[3] ?? 9);
  const report = await backfillEarlyWeeks(from, to);
  console.log(JSON.stringify(report, null, 2));
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Recupero giornate 1-9 non riuscito.";
  console.error(message);
  process.exit(1);
});
