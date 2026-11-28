import Link from "next/link";
import { checkAdminPage } from "@/components/admin/AdminGate";
import { ViewSwitch } from "@/components/ViewSwitch";
import { ADMIN_GROUPS } from "@/lib/admin-area";

export default async function AdminMenuPage() {
  const gate = await checkAdminPage();
  if (!gate.ok) return gate.screen;

  return (
    <section className="sa-page">
      <header className="sa-page-head">
        <h1 className="sa-title">Menu</h1>
      </header>
      <ViewSwitch to="player" className="sa-switch-menu" />
      <div className="sa-menu">
        {ADMIN_GROUPS.map((group) => (
          <section className="sa-menu-group" key={group.title}>
            <h2 className="sa-cap sa-muted">{group.title}</h2>
            <ul>
              {group.sections.map((section) => (
                <li key={section.href}>
                  <Link href={section.href}>
                    <span className="sa-grow">
                      <strong>{section.label}</strong>
                      <small>{section.hint}</small>
                    </span>
                    <span className="sa-chevron" aria-hidden="true">›</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </section>
  );
}
