export type OpenWeek = { number: number; deadlineAt: string; status: string };

export function decideAvailabilitySync(input: {
  ready: boolean;
  provider: string;
  force: boolean;
  open: OpenWeek | null;
  now: number;
}):
  | { action: "error"; status: number; message: string }
  | { action: "skip"; reason: string; matchday: number | null }
  | { action: "load"; matchday: number } {
  if (!input.ready) {
    return { action: "error", status: 503, message: "Manca la tabella. Esegui player_availability.sql nell'editor SQL." };
  }
  if (!input.open) return { action: "skip", reason: "Nessuna giornata aperta.", matchday: null };
  const deadlinePassed = new Date(input.open.deadlineAt).getTime() <= input.now;
  if (!input.force && deadlinePassed && input.open.status !== "scored" && input.open.status !== "final") {
    return { action: "skip", reason: "La giornata è già partita e non è ancora calcolata. Nessuna chiamata esterna.", matchday: input.open.number };
  }
  if (input.provider === "manual") {
    return { action: "skip", reason: "La fonte attiva è solo manuale.", matchday: input.open.number };
  }
  return { action: "load", matchday: input.open.number };
}

export function reconcileAutomaticRows(input: {
  matched: { playerId: string; status: string; playProbability: number | null }[];
  existing: { playerId: string; sourceProvider: string; status: string; playProbability: number | null }[];
}) {
  const manual = new Set(input.existing.filter((row) => row.sourceProvider === "manual").map((row) => row.playerId));
  const rows = input.matched.filter((row) => !manual.has(row.playerId));
  const keep = new Set(rows.map((row) => row.playerId));
  const stale = input.existing
    .filter((row) => row.sourceProvider !== "manual" && !keep.has(row.playerId))
    .map((row) => row.playerId);
  const changedIds = rows.filter((row) => {
    const before = input.existing.find((item) => item.playerId === row.playerId);
    if (!before || before.sourceProvider === "manual") return !before;
    return before.status !== row.status || Number(before.playProbability) !== Number(row.playProbability);
  }).map((row) => row.playerId);
  return { written: rows.length, stale, changedIds, changed: changedIds.length + stale.length };
}

export async function deliverAvailabilityNotices(send: () => Promise<unknown>) {
  try {
    await send();
  } catch {
    return;
  }
}
