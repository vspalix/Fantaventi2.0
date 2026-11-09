export const GAMEWEEK_STATUSES = ["scheduled", "open", "locked", "scored", "final"] as const;

export type GameweekStatus = (typeof GAMEWEEK_STATUSES)[number];

export const TEST_TEAM_PASSWORD = "Fantaventi-test-1";

export type TestLeagueOption = {
  id: string;
  name: string;
  startMatchday: number;
  endMatchday: number;
};

export type TestGameweek = {
  id: string;
  number: number;
  status: GameweekStatus;
  deadlineAt: string;
};

export type TestLabSnapshot = {
  seasonCode: string;
  leagues: TestLeagueOption[];
  gameweeks: TestGameweek[];
};

export type GeneratedTestTeam = {
  email: string;
  password: string;
  teamName: string;
  fantasyTeamId: string;
  players: number;
  goalkeepers: number;
  defenders: number;
  midfielders: number;
  forwards: number;
  lineupsFiled: number;
  firstLineup: number | null;
};

export type AdminLineupPlayer = {
  fullName: string;
  role: "GK" | "DEF" | "MID" | "FWD";
  clubShort: string;
  isCaptain: boolean;
  isVice: boolean;
};

export type AdminFiledLineup = {
  fantasyTeamId: string;
  teamName: string;
  displayName: string;
  isMine: boolean;
  filed: boolean;
  savedAt: string | null;
  starters: AdminLineupPlayer[];
  bench: AdminLineupPlayer[];
};

export type LateJoinReport = {
  email: string;
  password: string;
  teamName: string;
  fantasyTeamId: string;
  entryMatchday: number;
  startMatchday: number;
  weeksPrepared: number[];
  standing: {
    rank: number;
    teamName: string;
    points: number;
    realPoints: number;
    entryPoints: number;
    played: number;
    skipped: number;
    average: number | null;
  } | null;
  expectedSkipped: number;
  ok: boolean;
  notes: string[];
};
