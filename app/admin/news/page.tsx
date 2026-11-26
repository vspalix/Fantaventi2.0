import { checkAdminPage } from "@/components/admin/AdminGate";
import { NewsDesk } from "@/components/admin/NewsDesk";

export default async function AdminNewsPage() {
  const gate = await checkAdminPage();
  if (!gate.ok) return gate.screen;
  return (
    <section className="stack">
      <header>
        <h1 className="section-title">News</h1>
        <p className="lede">Gli avvisi pubblicati compaiono in home. Un link Telegram o un avviso di competizione sta qui.</p>
      </header>
      <NewsDesk />
    </section>
  );
}
