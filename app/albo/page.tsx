import Link from "next/link";
import { HallOfFameView } from "@/components/albo/HallOfFameView";
import { loadHallOfFame } from "@/lib/server/hall-of-fame";
import { publicError } from "@/lib/server/api-error";
import { getSessionUser } from "@/lib/server/session";

export default async function HallOfFamePage({ searchParams }: { searchParams: Promise<{ stagione?: string; cerca?: string; pagina?: string }> }) {
  const user = await getSessionUser();
  if (!user) {
    return (
      <section className="stack">
        <header>
          <h1 className="section-title">Albo d&apos;oro</h1>
        </header>
        <section className="card">
          <h2>Entra per leggere lo storico</h2>
          <p>Vincitori, podi e record delle stagioni chiuse sono visibili dopo l&apos;accesso.</p>
          <Link className="primary" href="/accesso?next=/albo">Accedi</Link>
        </section>
      </section>
    );
  }

  try {
    const wanted = await searchParams;
    const board = await loadHallOfFame({ seasonId: wanted.stagione, search: wanted.cerca, page: Number(wanted.pagina ?? 1), userId: user.id });
    return (
      <section className="stack">
        <header>
          <h1 className="section-title">Albo d&apos;oro</h1>
          <p className="al-lede">I vincitori e i record delle stagioni concluse.</p>
        </header>
        <HallOfFameView board={board} />
      </section>
    );
  } catch (error) {
    return (
      <section className="stack">
        <h1 className="section-title">Albo d&apos;oro</h1>
        <p className="banner">{publicError("Schermata Albo d'oro", error).message}</p>
      </section>
    );
  }
}
