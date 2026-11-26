import { AdminNav } from "@/components/admin/AdminNav";
import { UserDesk } from "@/components/admin/UserDesk";
import { listPlatformUsers } from "@/lib/server/platform-users";
import { isSuperAdmin } from "@/lib/server/platform-role";
import { publicError } from "@/lib/server/api-error";
import { getSessionUser } from "@/lib/server/session";

export default async function AdminUsersPage() {
  const user = await getSessionUser();
  if (!user || !(await isSuperAdmin(user.id))) return null;
  try {
    const users = await listPlatformUsers();
    return (
      <section className="stack">
        <header>
          <h1 className="section-title">Utenti</h1>
          <p className="lede">Account registrati. Da qui nomini un altro super admin: avrà laboratorio e registro, come te. Non puoi toglierti il ruolo da solo.</p>
        </header>
        <AdminNav />
        <UserDesk initial={users} currentUserId={user.id} />
      </section>
    );
  } catch (error) {
    return (
      <section className="stack">
        <h1 className="section-title">Utenti</h1>
        <AdminNav />
        <p className="banner">{publicError("Admin: Utenti", error).message}</p>
      </section>
    );
  }
}
