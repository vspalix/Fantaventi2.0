export const MATCH_CLOSE_MS = 130 * 60 * 1000;

export function isSettledGameweek(status: string) {
  return status === "scored" || status === "final";
}

export function isOfficialMatchClosed(status: string, kickoffAt: string | Date, now: Date) {
  if (status === "finished" || status === "FT") return true;
  const kickoff = kickoffAt instanceof Date ? kickoffAt.getTime() : new Date(kickoffAt).getTime();
  if (!Number.isFinite(kickoff)) return false;
  return now.getTime() >= kickoff + MATCH_CLOSE_MS;
}
