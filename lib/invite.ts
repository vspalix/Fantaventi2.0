export const INVITE_COOKIE = "fv-invite";
const INVITE_MAX_AGE = 60 * 60 * 24 * 14;

export function normalizeInviteCode(raw: string | null | undefined): string | null {
  const code = (raw ?? "").trim().toUpperCase();
  if (!/^[A-Z0-9]{4,12}$/.test(code)) return null;
  return code;
}

export function joinHref(code: string): string {
  return `/join?code=${encodeURIComponent(code)}`;
}

export function safeJoinPath(raw: string | null | undefined): string | null {
  if (!raw || !raw.startsWith("/join?") || raw.startsWith("//") || raw.includes("\\") || raw.includes("@")) return null;
  const query = raw.slice(raw.indexOf("?") + 1);
  const code = normalizeInviteCode(new URLSearchParams(query).get("code"));
  return code ? joinHref(code) : null;
}

export function inviteUrl(origin: string, code: string): string {
  return `${origin}${joinHref(code)}`;
}

export function readInviteCookie(): string | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(new RegExp(`(?:^|; )${INVITE_COOKIE}=([^;]*)`));
  return normalizeInviteCode(match ? decodeURIComponent(match[1]) : null);
}

export function writeInviteCookie(code: string) {
  if (typeof document === "undefined") return;
  const clean = normalizeInviteCode(code);
  if (!clean) return;
  document.cookie = `${INVITE_COOKIE}=${encodeURIComponent(clean)}; Path=/; Max-Age=${INVITE_MAX_AGE}; SameSite=Lax`;
}

export function clearInviteCookie() {
  if (typeof document === "undefined") return;
  document.cookie = `${INVITE_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`;
}

export function pendingInvitePath(): string {
  if (typeof window === "undefined") return "/";
  const next = safeJoinPath(new URLSearchParams(window.location.search).get("next"));
  if (next) return next;
  const code = readInviteCookie();
  return code ? joinHref(code) : "/";
}
