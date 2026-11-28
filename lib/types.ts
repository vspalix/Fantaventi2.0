import type { LineMark } from "@/lib/lineups/compact-sheet";
import type { LeagueRules } from "@/lib/league-rules";

export type CheckpointSnapshot = {
  afterMatchday: number;
  points: number;
  bonus: number;
  malus: number;
  rank: number;
  teams: number;
};

export type CheckpointHistory = {
  rows: CheckpointSnapshot[];
  nextAfter: number | null;
  configured: boolean;
};

export type PlayerRole = "GK" | "DEF" | "MID" | "FWD";

export type RosterRules = {
  squadSize: number;
  gkMin: number;
  gkMax: number;
  outfieldMin: number;
  outfieldMax: number;
};

export type ClubRef = {
  id: string;
  code: string;
  name: string;
  shortName: string;
};

export type CatalogPlayer = {
  id: string;
  fullName: string;
  role: PlayerRole;
  clubId: string;
  clubCode: string;
  clubName: string;
  clubShort: string;
  availability?: {
    status: "available" | "starter" | "bench" | "doubt" | "injured" | "suspended";
    playProbability: number | null;
    reason: string | null;
  };
};

export type CatalogResponse = {
  seasonId: string;
  seasonCode: string;
  clubs: ClubRef[];
  players: CatalogPlayer[];
  rules: RosterRules;
};

export type LeagueSummary = {
  id: string;
  name: string;
  joinCode: string;
  seasonCode: string;
  isOwner: boolean;
  isManager: boolean;
  teamId: string | null;
  teamName: string;
};

export type LeagueParticipant = {
  fantasyTeamId: string;
  userId: string;
  teamName: string;
  displayName: string;
  role?: "owner" | "admin" | "member";
};

export type RosterImportSource = {
  leagueId: string;
  leagueName: string;
  teamName: string;
  players: number;
};

export type LeagueDelegate = {
  userId: string;
  displayName: string;
};

export type LeagueDetail = LeagueSummary & {
  isOwner: boolean;
  isManager: boolean;
  platformOverride: boolean;
  isMember: boolean;
  participants: LeagueParticipant[];
  delegates: LeagueDelegate[];
  startMatchday: number;
  endMatchday: number;
  rangeReady: boolean;
  seasonId: string;
  roundCount: number;
  rules: LeagueRules;
};

export type HubGameweek = {
  id: string;
  number: number;
  deadlineAt: string;
  status: string;
  locked: boolean;
  isNext: boolean;
};

export type LineupPick = {
  playerIds: string[];
  benchIds: string[];
  captainId: string | null;
  viceId: string | null;
};

/** `office`: giornata chiusa senza formazione salvata, vale quella d'ufficio che il calcolo registrerà. */
export type LineupOrigin = "saved" | "previous" | "office" | "empty";

/** Risposta del salvataggio formazione: la formazione registrata e quando. */
export type SavedLineup = { lineup: LineupPick; savedAt: string | null };

/** Un bonus cambiato a lega iniziata: l'admin sceglie da quando vale. */
export type ScoringChoice = { fromMatchday: number; changed: string[] };

export type OpponentLineup = {
  fantasyTeamId: string;
  teamName: string;
  displayName: string;
  isMine: boolean;
  filed: boolean;
  /** Formazione d'ufficio: la squadra non ha salvato e vale quella che il calcolo registrerà. */
  office?: boolean;
  revealed: boolean;
  slots: {
    playerId: string;
    fullName: string;
    role: PlayerRole;
    clubShort: string;
    isCaptain: boolean;
    isVice: boolean;
  }[];
  bench: {
    playerId: string;
    fullName: string;
    role: PlayerRole;
    clubShort: string;
  }[];
  /** Voti in diretta: solo a giornata iniziata, non ancora calcolata e con la formazione visibile. */
  sheet?: LiveLineupSheet;
};

export type SquadPlayer = {
  id: string;
  fullName: string;
  role: PlayerRole;
  clubShort: string;
};

export type LeagueSquad = {
  fantasyTeamId: string;
  teamName: string;
  displayName: string;
  isMine: boolean;
  players: SquadPlayer[];
};

export type PartialStanding = {
  rank: number;
  fantasyTeamId: string;
  teamName: string;
  displayName: string;
  points: number | null;
  filed: boolean;
  office?: boolean;
  live: boolean;
};

export type LivePlayerRow = {
  playerId: string;
  fullName: string;
  role: PlayerRole;
  clubShort: string;
  isCaptain: boolean;
  isVice: boolean;
  voto: number | null;
  bonus: number | null;
  malus: number | null;
  fantavoto: number | null;
  formula: string | null;
  /** Il voto della sua squadra non è ancora arrivato: non è un «senza voto». */
  waiting: boolean;
  /** Bonus e malus presi finora, per le icone. */
  events: LineMark[];
};

export type LiveLineupSheet = {
  starters: LivePlayerRow[];
  bench: LivePlayerRow[];
  partialTotal: number | null;
  /** Formazione d'ufficio: chi non ha salvato vede quella che il calcolo registrerà. */
  office?: boolean;
  /** Penalità della lega per la formazione non inviata: è lei il punteggio della giornata. */
  penalty?: number | null;
};

export type HubFixture = {
  id: string;
  home: string;
  away: string;
  kickoffAt: string;
  status: string;
  homeGoals: number | null;
  awayGoals: number | null;
};

export type LeagueHome = {
  competitionName: string;
  phase: "countdown" | "live" | "none";
  deadlineAt: string | null;
  gameweekNumber: number | null;
  focusGameweekId: string | null;
  lineupSaved: boolean;
  lineupSavedAt: string | null;
  lastRoundNumber: number | null;
  lastRound: PartialStanding[];
  fixtureGameweekNumber: number | null;
  fixtures: HubFixture[];
  selectedFixtureNumber: number | null;
  selectedFixtures: HubFixture[];
};

export type StandingRow = {
  rank: number;
  fantasyTeamId: string;
  teamName: string;
  displayName: string;
  points: number;
  realPoints: number;
  entryPoints: number;
  played: number;
  skipped: number;
  average: number | null;
  best: number | null;
  ratedPlayers: number | null;
  onPitch: number | null;
};

export type LeagueHubData = {
  league: LeagueDetail;
  gameweeks: HubGameweek[];
  selectedGameweekId: string | null;
  editable: boolean;
  revealOpponents: boolean;
  roster: CatalogPlayer[];
  lineup: LineupPick;
  lineupOrigin: LineupOrigin;
  carriedFromMatchday: number | null;
  opponents: OpponentLineup[];
  squads: LeagueSquad[];
  partial: PartialStanding[];
  liveSheet: LiveLineupSheet | null;
  standings: StandingRow[];
  liveStandings: StandingRow[];
  liveReady: boolean;
  checkpointHistory: CheckpointHistory;
  home: LeagueHome;
};

export type RosterMarket = {
  locked: boolean;
  gameweekNumber: number | null;
  message: string | null;
};

export type RosterState = {
  teamId: string | null;
  teamName: string;
  playerIds: string[];
  appliesFrom: number;
  market: RosterMarket;
};

export const DEFAULT_RULES: RosterRules = {
  squadSize: 20,
  gkMin: 2,
  gkMax: 3,
  outfieldMin: 3,
  outfieldMax: 9,
};

export const ROLE_LABEL: Record<PlayerRole, string> = {
  GK: "Portieri",
  DEF: "Difensori",
  MID: "Centrocampisti",
  FWD: "Attaccanti",
};
