export type ClubBadgeOverride = {
  code: string;
  primary: string;
  secondary: string;
  logoUrl: string | null;
};

export type ClubColors = {
  code: string;
  name: string;
  short: string;
  colors: [string, string];
};

export const SERIE_A_CLUBS: ClubColors[] = [
  { code: "atalanta", name: "Atalanta", short: "ATA", colors: ["#1B4F9C", "#111111"] },
  { code: "bologna", name: "Bologna", short: "BOL", colors: ["#A11D2B", "#1B3A6B"] },
  { code: "cagliari", name: "Cagliari", short: "CAG", colors: ["#A11D2B", "#0033A0"] },
  { code: "como", name: "Como", short: "COM", colors: ["#1B4F9C", "#FFFFFF"] },
  { code: "cremonese", name: "Cremonese", short: "CRE", colors: ["#C8102E", "#9CA3AF"] },
  { code: "fiorentina", name: "Fiorentina", short: "FIO", colors: ["#4B2C82", "#FFFFFF"] },
  { code: "frosinone", name: "Frosinone", short: "FRO", colors: ["#FFD100", "#0033A0"] },
  { code: "genoa", name: "Genoa", short: "GEN", colors: ["#A11D2B", "#0033A0"] },
  { code: "inter", name: "Inter", short: "INT", colors: ["#010E80", "#111111"] },
  { code: "juventus", name: "Juventus", short: "JUV", colors: ["#FFFFFF", "#111111"] },
  { code: "lazio", name: "Lazio", short: "LAZ", colors: ["#87D8F7", "#FFFFFF"] },
  { code: "lecce", name: "Lecce", short: "LEC", colors: ["#FFD100", "#E10600"] },
  { code: "milan", name: "Milan", short: "MIL", colors: ["#E30613", "#111111"] },
  { code: "monza", name: "Monza", short: "MON", colors: ["#E30613", "#FFFFFF"] },
  { code: "napoli", name: "Napoli", short: "NAP", colors: ["#12A0D7", "#FFFFFF"] },
  { code: "parma", name: "Parma", short: "PAR", colors: ["#FFD100", "#0033A0"] },
  { code: "pisa", name: "Pisa", short: "PIS", colors: ["#0033A0", "#111111"] },
  { code: "roma", name: "Roma", short: "ROM", colors: ["#8E1F2F", "#F0BC42"] },
  { code: "sassuolo", name: "Sassuolo", short: "SAS", colors: ["#00A651", "#111111"] },
  { code: "torino", name: "Torino", short: "TOR", colors: ["#8B1E3F", "#FFFFFF"] },
  { code: "udinese", name: "Udinese", short: "UDI", colors: ["#FFFFFF", "#111111"] },
  { code: "venezia", name: "Venezia", short: "VEN", colors: ["#F36F21", "#111111"] },
  { code: "verona", name: "Verona", short: "VER", colors: ["#FFD100", "#0033A0"] },
];

const NEUTRAL: [string, string] = ["#3F3F46", "#27272A"];

const INDEX = new Map<string, ClubColors>();
for (const club of SERIE_A_CLUBS) {
  INDEX.set(club.code, club);
  INDEX.set(club.short.toLowerCase(), club);
  INDEX.set(club.name.toLowerCase(), club);
}

export function clubByName(teamName: string): ClubColors | null {
  const key = teamName.trim().toLowerCase();
  return INDEX.get(key) ?? null;
}

export function colorsFor(teamName: string): [string, string] {
  return clubByName(teamName)?.colors ?? NEUTRAL;
}
