// Chiama il ciclo di giornata dell'app: lock alla deadline, calcolo quando
// le partite sono finite e l'import voti c'è, final dopo 24 ore.
//
// Segreti della funzione: APP_URL, CRON_SECRET.
// Deploy: supabase functions deploy process-gameweek
// Pianificazione: Supabase Cron, oppure un ping diretto a APP_URL/api/cron/process-gameweek.

Deno.serve(async (request) => {
  const appUrl = Deno.env.get("APP_URL");
  const secret = Deno.env.get("CRON_SECRET");
  if (!appUrl || !secret) {
    return new Response("Mancano APP_URL e CRON_SECRET.", { status: 500 });
  }

  const incoming = request.headers.get("authorization") ?? "";
  if (incoming && incoming !== `Bearer ${secret}`) {
    return new Response("Cron non autorizzato.", { status: 401 });
  }

  const response = await fetch(`${appUrl.replace(/\/$/, "")}/api/cron/process-gameweek`, {
    method: "POST",
    headers: { Authorization: `Bearer ${secret}` },
  });
  return new Response(await response.text(), {
    status: response.status,
    headers: { "content-type": response.headers.get("content-type") ?? "application/json" },
  });
});
