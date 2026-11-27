import Link from "next/link";
import { cookies } from "next/headers";
import { SerieACalendar } from "@/components/serie-a/SerieACalendar";
import { SetupNotice } from "@/components/SetupNotice";
import { LEAGUE_FOCUS_COOKIE } from "@/lib/league-focus";
import { loadMyCalendarPlayers, loadSerieACalendar } from "@/lib/server/serie-a-calendar";
import { publicError } from "@/lib/server/api-error";
import { getSessionUser } from "@/lib/server/session";
import { hasServiceSupabaseEnv } from "@/lib/supabase/admin";
import { hasPublicSupabaseEnv } from "@/lib/supabase/server";

export default async function SerieAPage() {
  if (!hasPublicSupabaseEnv() || !hasServiceSupabaseEnv()) return <SetupNotice />;
  const user = await getSessionUser();
  if (!user) {
    return (
      <section className="card">
        <h2>Entra per vedere il calendario</h2>
        <Link className="primary" href="/accesso">Vai all&apos;accesso</Link>
      </section>
    );
  }
  try {
    const focusLeague = (await cookies()).get(LEAGUE_FOCUS_COOKIE)?.value ?? null;
    const [calendar, mine] = await Promise.all([loadSerieACalendar(), loadMyCalendarPlayers(user.id, focusLeague)]);
    return <SerieACalendar title={calendar.title} focus={calendar.focus} rounds={calendar.rounds} mine={mine} />;
  } catch (error) {
    return (
      <section className="card">
        <h2>Calendario non disponibile</h2>
        <p>{publicError("Schermata Calendario", error).message}</p>
      </section>
    );
  }
}
