import { AdminNav } from "@/components/admin/AdminNav";
import { UserDesk } from "@/components/admin/UserDesk";
import { listPlatformUsers } from "@/lib/server/platform-users";
import { isSuperAdmin } from "@/lib/server/platform-role";
import { errorMessage, getSessionUser } from "@/lib/server/session";

export default async function AdminUsersPage() {
  const user = await getSessionUser();
  if (!user || !(await isSuperAdmin(user.id))) return null;
  try {
    const users = await listPlatformUsers();
    return (
      <section className="stack">
        <header>
          <h1 className="section-title">Utenti</h1>
          <p className="lede">Account registrati, email e telefono. La reimpostazione obbliga a scegliere una nuova password al prossimo accesso.</p>
        </header>
        <AdminNav />
        <UserDesk initial={users} />
      </section>
    );
  } catch (error) {
    return (
      <section className="stack">
        <h1 className="section-title">Utenti</h1>
        <AdminNav />
        <p className="banner">{errorMessage(error)}</p>
      </section>
    );
  }
}
