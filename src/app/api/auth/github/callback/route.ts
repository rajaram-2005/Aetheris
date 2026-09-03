import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { STATE_COOKIE, requestOrigin, sessionCookie } from "@/lib/github/auth";
import { viewer } from "@/lib/github/api";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const jar = await cookies();
  const expected = jar.get(STATE_COOKIE)?.value;
  const home = requestOrigin(req) + "/";

  if (!code || !state || !expected || state !== expected) {
    return NextResponse.redirect(`${home}?auth=error&reason=state`);
  }

  const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: process.env.GITHUB_CLIENT_ID,
      client_secret: process.env.GITHUB_CLIENT_SECRET,
      code,
      redirect_uri: `${requestOrigin(req)}/api/auth/github/callback`,
    }),
  });
  const tok = (await tokenRes.json()) as { access_token?: string; error?: string };
  if (!tok.access_token) {
    return NextResponse.redirect(`${home}?auth=error&reason=${encodeURIComponent(tok.error ?? "token")}`);
  }

  const me = await viewer(tok.access_token);
  const res = NextResponse.redirect(`${home}?auth=ok`);
  res.cookies.set(sessionCookie({ token: tok.access_token, login: me.login, avatar: me.avatar_url, via: "oauth" }));
  res.cookies.delete(STATE_COOKIE);
  return res;
}
