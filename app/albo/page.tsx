import Link from "next/link";
import { EmptyState } from "@/components/EmptyState";
import { loadHallOfFame, type NamedScore } from "@/lib/server/hall-of-fame";
import { errorMessage, getSessionUser } from "@/lib/server/session";

const points = new Intl.NumberFormat("it-IT", { maximumFractionDigits: 2 });

function formatScore(row: NamedScore, suffix: string) {
  return `${row.teamName} · ${points.format(row.points)} ${suffix} · giornata ${row.gameweek}`;
}

export default async function HallOfFamePage() {
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
    const board = await loadHallOfFame();
    return (
      <section className="stack">
        <header>
          <h1 className="section-title">Albo d&apos;oro</h1>
          <p className="lede">
            Vincitori, podio e record delle stagioni archiviate. Una stagione entra qui quando il suo stato diventa closed.
          </p>
        </header>
        {board.seasons.length === 0 ? (
          <EmptyState title="Nessuna stagione archiviata">
            I podi compariranno quando una stagione viene chiusa. I punteggi già calcolati restano nel database e non vengono inventati.
          </EmptyState>
        ) : board.seasons.map((season) => (
          <section className="stack" key={season.seasonId}>
            <h2>Stagione {season.seasonCode}</h2>
            {season.leagues.length === 0 ? (
              <EmptyState title="Nessuna lega in questa stagione">Questa stagione è chiusa, ma non ha leghe da archiviare.</EmptyState>
            ) : season.leagues.map((league) => (
              <article className="card stack" key={league.leagueId}>
                <h3>{league.leagueName}</h3>
                {league.podium.length === 0 ? (
                  <p>Nessun punteggio ufficiale calcolato in questa lega.</p>
                ) : (
                  <ol className="list">
                    {league.podium.map((place) => (
                      <li key={`${league.leagueId}-${place.rank}`}>
                        <span className="player-main">
                          <strong>{place.rank}° {place.teamName}</strong>
                          <span className="small muted">{place.displayName}</span>
                        </span>
                        <span>{points.format(place.points)} fantapunti</span>
                      </li>
                    ))}
                  </ol>
                )}
                <p>{league.bestWeek ? `Record di giornata: ${formatScore(league.bestWeek, "fantapunti")}` : "Nessun record di giornata."}</p>
                <p>
                  {league.worstDefense
                    ? `Peggior difesa: ${formatScore(league.worstDefense, "di modificatore")}`
                    : "Nessun malus difesa registrato."}
                </p>
                <p>
                  {league.topScorer
                    ? `Capocannoniere: ${league.topScorer.playerName} · ${league.topScorer.goals} gol`
                    : "Nessun gol di un titolare registrato."}
                </p>
              </article>
            ))}
          </section>
        ))}
      </section>
    );
  } catch (error) {
    return (
      <section className="stack">
        <h1 className="section-title">Albo d&apos;oro</h1>
        <p className="banner">{errorMessage(error)}</p>
      </section>
    );
  }
}
