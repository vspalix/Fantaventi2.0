import { AdminNav } from "@/components/admin/AdminNav";
import { NewsDesk } from "@/components/admin/NewsDesk";

export default function AdminNewsPage() {
  return (
    <section className="stack">
      <header>
        <h1 className="section-title">News</h1>
        <p className="lede">Gli avvisi pubblicati compaiono in home. Un link Telegram o un avviso di competizione sta qui.</p>
      </header>
      <AdminNav />
      <NewsDesk />
    </section>
  );
}
