// Simula API-Football e registra il risultato con record_fixture_sync.
// save_mode = "automatic" aggiorna le deadline delle giornate scheduled.
// save_mode = "manual" conserva il payload finché non si chiama apply_calendar_sync.
//
// Deploy: supabase functions deploy sync-fixtures
// Richiede SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY nell'ambiente della funzione.

import { createClient } from "jsr:@supabase/supabase-js@2";

type SaveMode = "manual" | "automatic";

type Fixture = {
  external_ref: string;
  home_club_code: string;
  away_club_code: string;
  kickoff_at: string;
};

type Round = {
  number: number;
  first_kickoff: string;
  fixtures: Fixture[];
};

type SyncRequest = {
  season_id?: string;
  save_mode?: SaveMode;
  provider?: string;
  start_date?: string;
  rounds?: Round[];
};

const CLUBS = [
  "atalanta",
  "bologna",
  "cagliari",
  "como",
  "fiorentina",
  "frosinone",
  "genoa",
  "inter",
  "juventus",
  "lazio",
  "lecce",
  "milan",
  "monza",
  "napoli",
  "parma",
  "roma",
  "sassuolo",
  "torino",
  "udinese",
  "venezia",
];

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function simulateApiFootball(startDate: string, roundCount: number): Round[] {
  const start = new Date(startDate);
  if (Number.isNaN(start.getTime())) {
    throw new Error("start_date non è una data valida.");
  }
  const rounds = roundCount > 0 ? roundCount : 1;

  return Array.from({ length: rounds }, (_, index) => {
    const kickoff = new Date(start.getTime() + index * 7 * 24 * 60 * 60 * 1000);
    const kickoffAt = kickoff.toISOString();
    return {
      number: index + 1,
      first_kickoff: kickoffAt,
      fixtures: [
        {
          external_ref: `api-football-sim-gw-${index + 1}`,
          home_club_code: CLUBS[index % CLUBS.length],
          away_club_code: CLUBS[(index + 7) % CLUBS.length],
          kickoff_at: kickoffAt,
        },
      ],
    };
  });
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (request.method !== "POST") {
    return json({ error: "Usare POST." }, 405);
  }

  let body: SyncRequest;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Body JSON non valido." }, 400);
  }

  if (!body.season_id) {
    return json({ error: "season_id è obbligatorio." }, 400);
  }

  if (body.save_mode !== "manual" && body.save_mode !== "automatic") {
    return json({ error: "save_mode deve essere manual oppure automatic." }, 400);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    return json({ error: "Ambiente funzione incompleto." }, 500);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);
  let rounds = body.rounds;
  if (!rounds) {
    if (!body.start_date) {
      return json({ error: "Servono rounds oppure start_date per la simulazione." }, 400);
    }
    const counted = await supabase
      .from("gameweeks")
      .select("id", { count: "exact", head: true })
      .eq("season_id", body.season_id);
    if (counted.error) return json({ error: counted.error.message }, 400);
    try {
      rounds = simulateApiFootball(body.start_date, counted.count ?? 0);
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : "Simulazione non riuscita." }, 400);
    }
  }
  const { data, error } = await supabase.rpc("record_fixture_sync", {
    p_season_id: body.season_id,
    p_save_mode: body.save_mode,
    p_provider: body.provider ?? "api_football",
    p_payload: {
      simulated: body.rounds === undefined,
      provider: body.provider ?? "api_football",
      rounds,
    },
  });

  if (error) {
    return json({ error: error.message }, 400);
  }

  return json({
    simulated: body.rounds === undefined,
    save_mode: body.save_mode,
    result: data,
  });
});
