import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { AuthForm } from "@/components/auth/AuthForm";
import { SetupNotice } from "@/components/SetupNotice";
import { INVITE_COOKIE, joinHref, normalizeInviteCode, safeJoinPath } from "@/lib/invite";
import { getSessionUser } from "@/lib/server/session";
import { hasPublicSupabaseEnv } from "@/lib/supabase/server";

export default async function AccessPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const next = safeJoinPath((await searchParams).next);
  const cookieCode = normalizeInviteCode((await cookies()).get(INVITE_COOKIE)?.value);
  if (hasPublicSupabaseEnv() && await getSessionUser()) redirect(next ?? (cookieCode ? joinHref(cookieCode) : "/"));
  return (
    <section className="stack" style={{ maxWidth: 480 }}>
      {hasPublicSupabaseEnv() ? <div className="card"><AuthForm /></div> : <SetupNotice />}
    </section>
  );
}
