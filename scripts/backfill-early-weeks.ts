import { logFake, realExternalCallsAllowed, SOURCES_SWITCH } from "@/lib/outbound";
import { backfillEarlyWeeks } from "@/lib/server/backfill-early-weeks";

async function main() {
  // Questo script riscrive giornate nel database: serve la chiave aperta apposta.
  if (!realExternalCallsAllowed()) {
    logFake("Recupero giornate", `nessuna modifica. Per scrivere davvero nel database imposta ${SOURCES_SWITCH}=true.`);
    return;
  }
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
