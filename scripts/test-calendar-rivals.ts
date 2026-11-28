// Calendario Serie A: il calciatore di ogni club più scelto dagli avversari di lega.
// Finto Supabase in memoria: nessun database vero, nessuna rete.
import { FakeSupabase } from "./fake-supabase";
import { rivalPicks, type CalendarRivals } from "../lib/calendar-rivals";
import type { CatalogPlayer } from "../lib/types";

const failures: string[] = [];
let total = 0;

function check(name: string, actual: unknown, expected: unknown) {
  total += 1;
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    failures.push(`${name}: atteso ${JSON.stringify(expected)}, ottenuto ${JSON.stringify(actual)}`);
  }
}

const PLAYERS = [
  { id: "x1", name: "Bianchi", clubId: "x" },
  { id: "x2", name: "Rossi", clubId: "x" },
  { id: "y1", name: "Verdi", clubId: "y" },
  { id: "y2", name: "Neri", clubId: "y" },
];

const stint = (team: number, playerId: string, from = 1, until: number | null = null) => ({ team, playerId, from, until });

function pureChecks() {
  const rivals: CalendarRivals = {
    players: PLAYERS,
    stints: [
      stint(0, "x2"), stint(1, "x2"), stint(2, "x1"),
      stint(0, "y1"), stint(1, "y2"),
      // La squadra 2 cambia calciatore del club y dalla giornata 3.
      stint(2, "y1", 1, 2), stint(2, "y2", 3),
    ],
  };
  const first = rivalPicks(rivals, 1);
  check("Vince chi sta in più rose", first.get("x"), { id: "x2", name: "Rossi", percent: 67, ties: 0 });
  check("Conta la rosa di quella giornata", first.get("y"), { id: "y1", name: "Verdi", percent: 67, ties: 0 });
  check("Dopo il cambio vince il nuovo", rivalPicks(rivals, 3).get("y"), { id: "y2", name: "Neri", percent: 67, ties: 0 });

  const even = rivalPicks({ players: PLAYERS, stints: [stint(0, "x2"), stint(1, "x1")] }, 1);
  check("A pari merito primo in ordine alfabetico", even.get("x"), { id: "x1", name: "Bianchi", percent: 50, ties: 1 });
  check("Club che nessuno ha: niente", even.has("y"), false);

  const late = rivalPicks({ players: PLAYERS, stints: [stint(0, "x1"), stint(1, "x1", 5)] }, 1);
  check("Chi non ha ancora la rosa non abbassa la percentuale", late.get("x")?.percent, 100);

  const twice = rivalPicks({ players: PLAYERS, stints: [stint(0, "x1", 1, 3), stint(0, "x1", 3), stint(1, "x2")] }, 3);
  check("Una squadra conta una volta sola", twice.get("x"), { id: "x1", name: "Bianchi", percent: 50, ties: 1 });

  check("Prima di ogni rosa non esce niente", rivalPicks({ players: PLAYERS, stints: [stint(0, "x1", 4)] }, 3).size, 0);
}

async function loaderChecks() {
  const row = (id: string, team: string, playerId: string) => ({
    id, fantasy_team_id: team, player_id: playerId, active_from_gameweek: 1, active_until_gameweek: null,
  });
  const fake = new FakeSupabase({
    private_league_members: [
      ...["mia", "a", "b"].map((team) => ({ private_league_id: "lega", fantasy_team_id: team })),
      { private_league_id: "altra", fantasy_team_id: "fuori" },
      { private_league_id: "sola", fantasy_team_id: "mia" },
    ],
    roster_stints: [row("1", "mia", "x1"), row("2", "a", "x2"), row("3", "b", "x2"), row("4", "fuori", "y1"), row("5", "a", "ignoto")],
  });
  process.env.NEXT_PUBLIC_SUPABASE_URL = await fake.start();
  process.env.SUPABASE_SERVICE_ROLE_KEY = "chiave-finta";
  const catalog = Promise.resolve(PLAYERS.map((player) => ({ ...player, fullName: player.name }) as unknown as CatalogPlayer));
  try {
    const { loadRivalRosters } = await import("../lib/server/serie-a-calendar");
    const rivals = await loadRivalRosters("lega", "mia", catalog);
    check("Solo le rose degli altri della stessa lega", rivals?.players, [{ id: "x2", name: "Rossi", clubId: "x" }]);
    check("Nessun codice di squadra esce dal server", rivals?.stints, [stint(0, "x2"), stint(1, "x2")]);
    check("La propria rosa non conta", rivals ? rivalPicks(rivals, 1).get("x")?.percent : null, 100);
    check("Da soli in lega non c'è confronto", await loadRivalRosters("sola", "mia", catalog), null);
    check("Il calendario non scrive niente", fake.writes().length, 0);
    delete fake.tables.roster_stints;
    check("Se le rose non si leggono il calendario resta", await loadRivalRosters("lega", "mia", catalog), null);
  } finally {
    await fake.stop();
  }
}

async function main() {
  pureChecks();
  await loaderChecks();
  console.log(`${failures.length === 0 ? "PASSED" : "FAILED"} ${total - failures.length}/${total}`);
  for (const failure of failures) console.log(`- ${failure}`);
  process.exit(failures.length === 0 ? 0 : 1);
}

void main();
