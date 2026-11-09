export function totalsDelta(before: number[], after: number[]) {
  const width = Math.max(before.length, after.length);
  let delta = 0;
  for (let index = 0; index < width; index += 1) {
    delta += Math.abs((before[index] ?? 0) - (after[index] ?? 0));
  }
  return Math.round(delta * 100) / 100;
}

export function weekCountsInTable(
  mode: "classic" | "head_to_head" | "knockout",
  matchPostponed: boolean,
  postponement: "political_six" | "wait_recovery",
) {
  if (mode === "knockout") return false;
  if (mode === "head_to_head" && matchPostponed && postponement === "wait_recovery") return false;
  return true;
}
