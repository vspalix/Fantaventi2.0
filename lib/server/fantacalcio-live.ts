export type FantacalcioPlayerVote = {
  externalRef: string;
  teamSlug: string;
  voto: number | null;
  goals: number;
  assists: number;
  yellowCards: number;
  redCards: number;
  penaltiesScored: number;
  penaltiesMissed: number;
  penaltiesSaved: number;
  ownGoals: number;
  goalsConceded: number;
};

export type FantacalcioFixtureScore = {
  homeSlug: string;
  awaySlug: string;
  homeGoals: number | null;
  awayGoals: number | null;
};

const SOURCE = "https://www.fantacalcio.it";
const COUNT_FIELDS = [
  "goals",
  "assists",
  "yellowCards",
  "redCards",
  "penaltiesScored",
  "penaltiesMissed",
  "penaltiesSaved",
  "ownGoals",
  "goalsConceded",
] as const;

export class VoteIngestionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VoteIngestionError";
  }
}

export function validateFantacalcioVote(value: unknown): FantacalcioPlayerVote | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Partial<FantacalcioPlayerVote>;
  if (typeof row.externalRef !== "string" || !/^\d+$/.test(row.externalRef)) return null;
  if (typeof row.teamSlug !== "string" || !/^[a-z0-9-]+$/.test(row.teamSlug)) return null;
  if (row.voto !== null && (typeof row.voto !== "number" || !Number.isFinite(row.voto) || row.voto < 0 || row.voto > 10)) return null;
  for (const field of COUNT_FIELDS) {
    const count = row[field];
    if (typeof count !== "number" || !Number.isInteger(count) || count < 0 || count > 20) return null;
  }
  return {
    externalRef: row.externalRef,
    teamSlug: row.teamSlug,
    voto: row.voto ?? null,
    goals: row.goals ?? 0,
    assists: row.assists ?? 0,
    yellowCards: row.yellowCards ?? 0,
    redCards: row.redCards ?? 0,
    penaltiesScored: row.penaltiesScored ?? 0,
    penaltiesMissed: row.penaltiesMissed ?? 0,
    penaltiesSaved: row.penaltiesSaved ?? 0,
    ownGoals: row.ownGoals ?? 0,
    goalsConceded: row.goalsConceded ?? 0,
  };
}

export function assertVoteDocument(status: number, body: unknown) {
  if (status >= 500 || status === 408 || status === 429) {
    throw new VoteIngestionError(`Fonte voti non disponibile (${status}). Nessun voto salvato.`);
  }
  if (status < 200 || status >= 300) {
    throw new VoteIngestionError(`Fonte voti ha risposto ${status}. Nessun voto salvato.`);
  }
  if (typeof body !== "string") {
    throw new VoteIngestionError("Risposta voti incompleta. Nessun voto salvato.");
  }
  const text = body.trim();
  if (!text || text.startsWith("{") || text.startsWith("[")) {
    throw new VoteIngestionError("Risposta voti incompleta. Nessun voto salvato.");
  }
  return body;
}

function parseGrade(raw: string) {
  const text = raw.trim().toLowerCase().replace(",", ".");
  if (!text || text === "56" || text === "-" || text === "sv" || text === "s.v." || text === "n.d.") return null;
  const vote = Number(text.replace("*", ""));
  if (!Number.isFinite(vote) || vote < 0 || vote > 10) return null;
  return vote;
}

function parseCount(raw: string | undefined) {
  const value = Number(raw ?? "");
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.trunc(value));
}

export function parseFantacalcioGrades(html: string): FantacalcioPlayerVote[] {
  const votes: FantacalcioPlayerVote[] = [];
  const rows = html.match(/<tr\b[\s\S]*?<\/tr>/gi) ?? [];
  for (const row of rows) {
    const player = row.match(/\/squadre\/([a-z0-9-]+)\/[^"']+\/(\d+)/i);
    const grade = row.match(/class="player-grade\s*([^"]*)"\s+data-value="([^"]*)"/i);
    if (!player || !grade) continue;
    const bonuses = [...row.matchAll(/class="player-bonus\b[^"]*"\s+data-value="([^"]*)"/gi)].map((match) => match[1]);
    const marker = grade[1] ?? "";
    const redCards = /red-card/i.test(marker) ? 1 : 0;
    const yellowCards = redCards === 0 && /yellow-card/i.test(marker) ? 1 : 0;
    votes.push({
      externalRef: player[2],
      teamSlug: player[1].toLowerCase(),
      voto: parseGrade(grade[2]),
      goals: parseCount(bonuses[0]),
      goalsConceded: parseCount(bonuses[1]),
      ownGoals: parseCount(bonuses[2]),
      penaltiesScored: parseCount(bonuses[3]),
      penaltiesMissed: parseCount(bonuses[4]),
      penaltiesSaved: parseCount(bonuses[5]),
      assists: parseCount(bonuses[6]),
      yellowCards,
      redCards,
    });
  }
  return votes;
}

export function parseFantacalcioScores(html: string): FantacalcioFixtureScore[] {
  const scores: FantacalcioFixtureScore[] = [];
  const blocks = html.match(/<li id="match-\d+"[\s\S]*?<\/li>/gi) ?? [];
  for (const block of blocks) {
    const teams = block.match(/\/calendario\/\d+\/[^/"']+\/([a-z0-9]+)-([a-z0-9]+)\/\d+/i);
    const home = block.match(/class="score-home">\s*(\d+)/i);
    const away = block.match(/class="score-away">\s*(\d+)/i);
    if (!teams) continue;
    scores.push({
      homeSlug: teams[1].toLowerCase(),
      awaySlug: teams[2].toLowerCase(),
      homeGoals: home ? Number(home[1]) : null,
      awayGoals: away ? Number(away[1]) : null,
    });
  }
  return scores;
}

export function votesForClubs(votes: FantacalcioPlayerVote[], homeSlug: string, awaySlug: string) {
  const clubs = new Set([homeSlug, awaySlug]);
  return votes.filter((vote) => clubs.has(vote.teamSlug) && vote.voto !== null);
}

export function readVotePage(status: number, body: unknown) {
  const html = assertVoteDocument(status, body);
  const votes = parseFantacalcioGrades(html);
  if (votes.some((vote) => validateFantacalcioVote(vote) === null)) {
    throw new VoteIngestionError("Schema voti non valido. Nessun voto salvato.");
  }
  return {
    votes,
    scores: parseFantacalcioScores(html),
  };
}

export async function fetchFantacalcioMatchweek(seasonCode: string, gameweekNumber: number) {
  const url = `${SOURCE}/serie-a/voti/${encodeURIComponent(seasonCode)}/${gameweekNumber}`;
  let response: Response;
  try {
    response = await fetch(url, {
      headers: {
        Accept: "text/html",
        "User-Agent": "Fantaventi/1.0",
      },
      signal: AbortSignal.timeout(20000),
    });
  } catch {
    throw new VoteIngestionError(`Fonte voti non raggiungibile per la giornata ${gameweekNumber}. Nessun voto salvato.`);
  }
  let body = "";
  try {
    body = await response.text();
  } catch {
    throw new VoteIngestionError(`Risposta voti interrotta per la giornata ${gameweekNumber}. Nessun voto salvato.`);
  }
  try {
    const page = readVotePage(response.status, body);
    return { url, ...page };
  } catch (error) {
    if (error instanceof VoteIngestionError) throw error;
    throw new VoteIngestionError(`Schema voti non valido per la giornata ${gameweekNumber}. Nessun voto salvato.`);
  }
}
