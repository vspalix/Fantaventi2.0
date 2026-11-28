import Link from "next/link";
import { EmptyState } from "@/components/EmptyState";
import { ScoreIcon } from "@/components/scores/ScoreIcons";
import type { HallOfFame, Leader, LeagueArchive } from "@/lib/server/hall-of-fame";

const points = new Intl.NumberFormat("it-IT", { maximumFractionDigits: 2 });

function Cup() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M7 4h10v6a5 5 0 0 1-10 0zM7 6H4.500A2.500 2.500 0 0 0 7.500 10.500M17 6h2.500a2.500 2.500 0 0 1-3 4.500M12 15v3.500M8 20.500h8" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function Bolt() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" className="score-icon">
      <path d="M11 2 4.500 11.200H9L8 18l7-9.800h-4.800z" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  );
}

function Record({ icon, label, who, value }: { icon: React.ReactNode; label: string; who: string; value: string }) {
  return (
    <li className="al-record">
      <span className="al-record-icon">{icon}</span>
      <span className="al-record-text">
        <small>{label}</small>
        <strong>{who}</strong>
      </span>
      <b>{value}</b>
    </li>
  );
}

function who(leader: Leader) {
  return leader.teams.length <= 2 ? leader.teams.join(" · ") : `${leader.teams.length} squadre a pari merito`;
}

function League({ league }: { league: LeagueArchive }) {
  const { bestWeek, roundWins, captain, defense, fairPlay } = league;
  return (
    <article className="card al-league">
      <h2>{league.leagueName}</h2>
      {league.podium.length === 0 ? (
        <p className="al-empty">Nessun punteggio ufficiale in questa lega.</p>
      ) : (
        // In pagina il primo sta al centro; in lettura l'ordine resta 1, 2, 3.
        <ol className="al-podium">
          {league.podium.map((place, index) => (
            <li key={place.teamId} data-place={index + 1} data-rank={place.rank}>
              <div className="al-who">
                {place.rank === 1 ? <span className="al-cup"><Cup /></span> : null}
                <strong>{place.teamName}</strong>
                {place.displayName ? <small>{place.displayName}</small> : null}
                <b>{points.format(place.points)}</b>
                <small>{place.points === 1 && league.unit === "punti" ? "punto" : league.unit}</small>
              </div>
              <span className="al-step" aria-label={`${place.rank}° posto`}>{place.rank}°</span>
            </li>
          ))}
        </ol>
      )}
      {bestWeek || roundWins || captain || defense || fairPlay ? (
        <ul className="al-records">
          {bestWeek ? (
            <Record icon={<Bolt />} label={`Record di giornata · giornata ${bestWeek.gameweek}`} who={bestWeek.teamName} value={points.format(bestWeek.points)} />
          ) : null}
          {roundWins ? (
            <Record icon={<Cup />} label="Più volte primo di giornata" who={who(roundWins)} value={`${roundWins.value} ${roundWins.value === 1 ? "volta" : "volte"}`} />
          ) : null}
          {captain ? (
            <Record icon={<ScoreIcon kind="captain" />} label="Capitano d'oro · punti dalla fascia" who={who(captain)} value={`+${points.format(captain.value)}`} />
          ) : null}
          {defense ? (
            <Record icon={<ScoreIcon kind="defense" />} label="Muro difensivo · punti dal modificatore" who={who(defense)} value={`+${points.format(defense.value)}`} />
          ) : null}
          {fairPlay ? (
            <Record icon={<ScoreIcon kind="fairplay" />} label="Re del fair play · giornate senza ammonizioni" who={who(fairPlay)} value={`${fairPlay.value}`} />
          ) : null}
        </ul>
      ) : null}
    </article>
  );
}

/** L'indirizzo dell'Albo per una stagione, una ricerca e una pagina. */
function address(seasonId: string, search = "", page = 1) {
  const query = new URLSearchParams({ stagione: seasonId });
  if (search) query.set("cerca", search);
  if (page > 1) query.set("pagina", String(page));
  return `/albo?${query}`;
}

/** Le stagioni concluse: si sceglie la stagione, poi ogni lega ha podio e record. Le leghe vanno a pagine. */
export function HallOfFameView({ board }: { board: HallOfFame }) {
  const { seasons, search, page, more } = board;
  const season = seasons.find((item) => item.seasonId === board.chosen) ?? seasons[0];
  if (!season) {
    return (
      <EmptyState title="Nessuna stagione conclusa">
        I podi compariranno qui quando finisce una stagione.
      </EmptyState>
    );
  }
  return (
    <div className="al">
      {seasons.length > 1 ? (
        <div className="al-seasons" role="group" aria-label="Stagione">
          {seasons.map((item) => (
            <Link key={item.seasonId} href={address(item.seasonId)} aria-current={item.seasonId === season.seasonId ? "true" : undefined}>
              {item.seasonCode}
            </Link>
          ))}
        </div>
      ) : (
        <p className="al-season">Stagione {season.seasonCode}</p>
      )}
      {more || page > 1 || search ? (
        <form className="al-search" action="/albo" method="get">
          <input type="hidden" name="stagione" value={season.seasonId} />
          <input type="search" name="cerca" defaultValue={search} aria-label="Cerca una lega" placeholder="Cerca una lega per nome" />
          <button className="ghost" type="submit">Cerca</button>
        </form>
      ) : null}
      {season.leagues.length === 0 ? (
        search ? (
          <EmptyState title="Nessuna lega con questo nome">Prova con un altro nome.</EmptyState>
        ) : (
          <EmptyState title="Nessuna lega in questa stagione">La stagione è conclusa, ma non ha leghe da ricordare.</EmptyState>
        )
      ) : (
        <div className="al-leagues">
          {season.leagues.map((league) => <League key={league.leagueId} league={league} />)}
        </div>
      )}
      {more || page > 1 ? (
        <nav className="al-pages" aria-label="Altre leghe">
          {page > 1 ? <Link className="ghost" href={address(season.seasonId, search, page - 1)}>Leghe precedenti</Link> : <span />}
          {more ? <Link className="ghost" href={address(season.seasonId, search, page + 1)}>Altre leghe</Link> : <span />}
        </nav>
      ) : null}
    </div>
  );
}
