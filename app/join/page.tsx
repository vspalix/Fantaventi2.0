import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { JoinClient } from "@/components/join/JoinClient";
import { INVITE_COOKIE, joinHref, normalizeInviteCode, safeJoinPath } from "@/lib/invite";
import { getSessionUser } from "@/lib/server/session";
import { hasPublicSupabaseEnv } from "@/lib/supabase/server";

export default async function JoinPage({
  searchParams,
}: {
  searchParams: Promise<{ code?: string }>;
}) {
  const params = await searchParams;
  const cookieCode = normalizeInviteCode((await cookies()).get(INVITE_COOKIE)?.value);
  const code = normalizeInviteCode(params.code) ?? cookieCode;
  if (!code) redirect("/");
  const next = safeJoinPath(joinHref(code));
  const user = hasPublicSupabaseEnv() ? await getSessionUser() : null;
  if (!user) redirect(`/accesso?next=${encodeURIComponent(next ?? joinHref(code))}`);
  return <JoinClient code={code} />;
}
