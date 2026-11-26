import { checkAdminPage } from "@/components/admin/AdminGate";
import { UserDesk } from "@/components/admin/UserDesk";
import { listPlatformUsers } from "@/lib/server/platform-users";
import { publicError } from "@/lib/server/api-error";

export default async function AdminUsersPage() {
  const gate = await checkAdminPage();
  if (!gate.ok) return gate.screen;
  const { user } = gate;
  try {
    const users = await listPlatformUsers();
    return (
      <section className="stack">
        <header>
          <h1 className="section-title">Utenti</h1>
          <p className="lede">Account registrati. Da qui nomini un altro super admin: avrà laboratorio e registro, come te. Non puoi toglierti il ruolo da solo.</p>
        </header>
        <UserDesk initial={users} currentUserId={user.id} />
      </section>
    );
  } catch (error) {
    return (
      <section className="stack">
        <h1 className="section-title">Utenti</h1>
        <p className="banner">{publicError("Admin: Utenti", error).message}</p>
      </section>
    );
  }
}
