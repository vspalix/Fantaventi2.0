import { LeaguesPreview } from "@/components/leagues/LeagueListCard";
import { LeaguesHeader } from "@/components/leagues/LeaguesHeader";

export default function LeaguesLoading() {
  return (
    <section className="stack">
      <LeaguesHeader />
      <LeaguesPreview />
    </section>
  );
}
