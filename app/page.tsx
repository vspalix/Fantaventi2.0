import Link from "next/link";
import { HomeDashboard } from "@/components/home/HomeDashboard";
import { loadHomeBoard } from "@/lib/server/home-board";
import { errorMessage, getSessionUser } from "@/lib/server/session";
import { hasServiceSupabaseEnv } from "@/lib/supabase/admin";
import { hasPublicSupabaseEnv } from "@/lib/supabase/server";

export default async function HomePage() {
  const user = hasPublicSupabaseEnv() ? await getSessionUser() : null;
  if (user && hasServiceSupabaseEnv()) {
    try {
      return <HomeDashboard board={await loadHomeBoard(user.id)} />;
    } catch (error) {
      return (
        <section className="card">
          <h2>Home non disponibile</h2>
          <p>{errorMessage(error)}</p>
        </section>
      );
    }
  }

  return (
    <section className="hero">
      <p className="small muted">Fantaventi</p>
      <h1>Costruisci la rosa. Invita la lega.</h1>
      <p className="lede">
        Un calciatore per club. La home, dopo l&apos;accesso, riunisce classifica, deadline, partite e news.
      </p>
      <div className="grid-2">
        <Link className="card" href="/leghe">
          <h2>Leghe</h2>
          <p>Crea un codice invito oppure entra in una lega già aperta.</p>
        </Link>
        <Link className="card" href="/accesso">
          <h2>Entra</h2>
          <p>La plancia personale si apre con il tuo account.</p>
        </Link>
      </div>
    </section>
  );
}
