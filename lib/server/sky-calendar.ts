import type { CalendarFixture, CalendarRound } from "@/lib/server/serie-a-calendar";

const SKY_CALENDAR_URL = "https://sport.sky.it/calcio/serie-a/calendario-risultati";

const MONTHS: Record<string, number> = {
  gen: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  mag: 5,
  giu: 6,
  lug: 7,
  ago: 8,
  set: 9,
  ott: 10,
  nov: 11,
  dic: 12,
};

const CLUBS: Record<string, string> = {
  atalanta: "atalanta",
  bologna: "bologna",
  cagliari: "cagliari",
  como: "como",
  fiorentina: "fiorentina",
  frosinone: "frosinone",
  genoa: "genoa",
  inter: "inter",
  juventus: "juventus",
  lazio: "lazio",
  lecce: "lecce",
  milan: "milan",
  monza: "monza",
  napoli: "napoli",
  parma: "parma",
  roma: "roma",
  sassuolo: "sassuolo",
  torino: "torino",
  udinese: "udinese",
  venezia: "venezia",
};

function pad(value: number) {
  return String(value).padStart(2, "0");
}

export function europeRomeOffset(year: number, month: number, day: number, hour: number, minute: number) {
  const stamp = year * 100000000 + month * 1000000 + day * 10000 + hour * 100 + minute;
  const dstEnd2026 = 202610250300;
  const dstStart2027 = 202703280200;
  const dstEnd2027 = 202710310300;
  if (stamp < dstEnd2026 || (stamp >= dstStart2027 && stamp < dstEnd2027)) return "+02:00";
  return "+01:00";
}

export function romeLocalToIso(value: string) {
  const match = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) return null;
  const offset = europeRomeOffset(year, month, day, hour, minute);
  return `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:00${offset}`;
}

function clubCode(name: string) {
  return CLUBS[name.trim().toLowerCase()] ?? null;
}

export function parseSkyCalendar(html: string): CalendarRound[] {
  const parts = html.split(/id="giornata-(\d+)"/);
  const rounds: CalendarRound[] = [];
  for (let index = 1; index < parts.length; index += 2) {
    const number = Number(parts[index]);
    const body = parts[index + 1] ?? "";
    if (!Number.isInteger(number) || number < 1) continue;
    const fixtures: CalendarFixture[] = [];
    let date: { year: number; month: number; day: number } | null = null;
    let pending: { home: string; away: string } | null = null;
    const tokens = body.matchAll(
      /ftbl__match-data-row__date-long">([^<]+)|aria-label="Vai alla partita ([^"]+)"|ftbl__result-label" data-state="([^"]*)">([^<]*)</g,
    );
    for (const token of tokens) {
      if (token[1]) {
        const day = token[1].match(/(\d{1,2})\s+(Gen|Feb|Mar|Apr|Mag|Giu|Lug|Ago|Set|Ott|Nov|Dic)\s+(\d{4})/i);
        date = day
          ? { day: Number(day[1]), month: MONTHS[day[2].toLowerCase()], year: Number(day[3]) }
          : null;
        pending = null;
        continue;
      }
      if (token[2]) {
        const names = token[2].split(" - ");
        if (names.length === 2) pending = { home: names[0], away: names[1] };
        continue;
      }
      if (!pending || !date) continue;
      const state = token[3] ?? "";
      const label = (token[4] ?? "").trim();
      const home = clubCode(pending.home);
      const away = clubCode(pending.away);
      const time = label.match(/^(\d{1,2}):(\d{2})$/);
      const score = label.match(/^(\d+)\s*-\s*(\d+)$/);
      if (home && away && home !== away && state === "prematch" && time) {
        fixtures.push({
          home,
          away,
          kickoff: `${date.year}-${pad(date.month)}-${pad(date.day)}T${pad(Number(time[1]))}:${time[2]}:00${europeRomeOffset(date.year, date.month, date.day, Number(time[1]), Number(time[2]))}`,
          timeKnown: true,
        });
      } else if (home && away && home !== away && state === "ended" && score) {
        fixtures.push({
          home,
          away,
          kickoff: "",
          timeKnown: false,
          homeGoals: Number(score[1]),
          awayGoals: Number(score[2]),
        });
      }
      pending = null;
    }
    if (fixtures.length > 0) rounds.push({ number, fixtures });
  }
  return rounds;
}

export async function fetchSkyCalendar() {
  const response = await fetch(SKY_CALENDAR_URL, {
    cache: "no-store",
    headers: { "user-agent": "Fantaventi/1.0" },
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) {
    throw new Error(`Sky Sport ha risposto ${response.status}.`);
  }
  const html = await response.text();
  const rounds = parseSkyCalendar(html);
  const fixtures = rounds.reduce((sum, round) => sum + round.fixtures.length, 0);
  if (fixtures < 100) {
    throw new Error("Il calendario Sky non ha abbastanza orari. Riprova tra poco.");
  }
  return rounds;
}
