import type { PlayerRole } from "@/lib/types";

export type AdapterSource = {
  fileName?: string;
  bytes?: Buffer;
  json?: unknown;
};

export type ProviderInfo = {
  id: string;
  label: string;
};

export type NormalizedPlayer = {
  externalRef: string;
  name: string;
  clubName: string;
  role: PlayerRole;
};

export type NormalizedListone = {
  active: NormalizedPlayer[];
  released: NormalizedPlayer[];
};

export type NormalizedVote = {
  externalRef: string;
  name: string;
  clubName: string;
  voto: number;
  goals: number;
  assists: number;
  yellowCards: number;
  redCards: number;
  penaltiesScored: number;
  penaltiesMissed: number;
  penaltiesSaved: number;
  ownGoals: number;
  goalsConceded: number;
  postponed?: boolean;
};

export type NormalizedVotes = {
  votes: NormalizedVote[];
  skippedWithoutVote: number;
};

export interface ListoneAdapter {
  readonly id: string;
  readonly label: string;
  parse(source: AdapterSource): Promise<NormalizedListone>;
}

export interface VotesAdapter {
  readonly id: string;
  readonly label: string;
  parse(source: AdapterSource): Promise<NormalizedVotes>;
}
