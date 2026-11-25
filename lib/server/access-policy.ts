export function cronSecretAccepted(headers: Headers, secret: string | undefined) {
  if (!secret) return false;
  const header = headers.get("authorization") ?? "";
  const bearer = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";
  const alternate = headers.get("x-cron-secret") ?? "";
  return bearer === secret || alternate === secret;
}

export function hostViewAllowed(platformAdmin: boolean, mode: "host" | "player") {
  return mode !== "host" || platformAdmin;
}

export function leagueActor(input: {
  userId: string;
  ownerId: string;
  delegateIds: readonly string[];
  isMember: boolean;
  platformAdmin: boolean;
}) {
  const isManager = input.userId === input.ownerId || input.delegateIds.includes(input.userId) || input.platformAdmin;
  return {
    isManager,
    canEnter: isManager || input.isMember,
    canEditLeague: isManager,
    canOpenLaboratorio: input.platformAdmin,
    canSwitchHost: input.platformAdmin,
  };
}
