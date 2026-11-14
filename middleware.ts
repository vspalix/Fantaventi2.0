import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { INVITE_COOKIE, normalizeInviteCode, safeJoinPath } from "@/lib/invite";

export async function middleware(request: NextRequest) {
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-pathname", request.nextUrl.pathname);
  let response = NextResponse.next({ request: { headers: requestHeaders } });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    rememberInvite(request, response);
    return response;
  }
  // Le route API verificano la sessione da sole. Un secondo refresh sullo stesso
  // token la invalida e il laboratorio torna sulla schermata Entra.
  if (request.nextUrl.pathname.startsWith("/api/")) {
    rememberInvite(request, response);
    return response;
  }

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request: { headers: requestHeaders } });
        cookiesToSet.forEach(({ name, value, options }) => {
          response.cookies.set(name, value, options);
        });
      },
    },
  });

  await supabase.auth.getUser();
  rememberInvite(request, response);
  return response;
}

function rememberInvite(request: NextRequest, response: NextResponse) {
  const fromJoin = request.nextUrl.pathname === "/join" ? request.nextUrl.searchParams.get("code") : null;
  const nextPath = safeJoinPath(request.nextUrl.searchParams.get("next"));
  const fromNext = nextPath ? new URLSearchParams(nextPath.slice(nextPath.indexOf("?") + 1)).get("code") : null;
  const code = normalizeInviteCode(fromJoin) ?? normalizeInviteCode(fromNext);
  if (!code) return;
  response.cookies.set(INVITE_COOKIE, code, { path: "/", maxAge: 60 * 60 * 24 * 14, sameSite: "lax" });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
