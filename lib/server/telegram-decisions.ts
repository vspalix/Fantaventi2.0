export type SyncStatus = "success" | "error" | "skipped";

export type VoteAlertKind = "error" | "success" | "morning-empty" | "none";
export type KickoffAlertKind = "error" | "success" | "none";
export type AvailabilityAlertKind = "writes" | "unmatched" | "none";

export function voteAlertKind(input: {
  status: SyncStatus;
  jobType: string;
  recordsWritten: number;
  force: boolean;
  changed: number | null;
  successEnabled: boolean;
  morningClosing: boolean;
  playedDayStillOpen: boolean;
}): VoteAlertKind {
  if (input.status === "error") return "error";
  if (input.status === "success" && input.changed !== null && input.changed > 0 && input.successEnabled) return "success";
  if (input.force || input.jobType !== "votes" || input.status !== "success" || input.recordsWritten !== 0) return "none";
  if (!input.morningClosing || !input.playedDayStillOpen) return "none";
  return "morning-empty";
}

export function voteAlertNeedsMorning(input: {
  status: SyncStatus;
  jobType: string;
  recordsWritten: number;
  force: boolean;
  changed: number | null;
  successEnabled: boolean;
}) {
  return voteAlertKind({ ...input, morningClosing: true, playedDayStillOpen: true }) === "morning-empty";
}

export function kickoffAlertKind(input: {
  status: "success" | "error";
  changed: number;
  successEnabled: boolean;
}): KickoffAlertKind {
  if (input.status === "error") return "error";
  if (input.changed <= 0 || !input.successEnabled) return "none";
  return "success";
}

export function availabilityWriteKind(changed: number): AvailabilityAlertKind {
  return changed > 0 ? "writes" : "none";
}

export function unmatchedAlertKind(count: number): AvailabilityAlertKind {
  return count > 0 ? "unmatched" : "none";
}

export function availabilitySummaryKind(input: {
  status: SyncStatus;
  changed: number;
  successEnabled: boolean;
}): "error" | "success" | "none" {
  if (input.status === "error") return "error";
  if (input.status !== "success" || input.changed <= 0 || !input.successEnabled) return "none";
  return "success";
}
