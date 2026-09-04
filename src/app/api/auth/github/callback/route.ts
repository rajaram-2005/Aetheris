import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { STATE_COOKIE, requestOrigin, sessionCookie } from "@/lib/github/auth";
import { viewer } from "@/lib/github/api";
import { getSessionAccount, mergeAnonymous, resolveAccount, sessionCookies } from "@/lib/auth/accounts";
import { getUserId } from "@/lib/user";

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
  // Primary verified email (for identity linking with Google / email sign-in).
  let email: string | undefined;
  try {
    const emails = await fetch("https://api.github.com/user/emails", { headers: { Authorization: `Bearer ${tok.access_token}`, Accept: "application/vnd.github+json" } }).then((r) => r.json()) as { email: string; primary: boolean; verified: boolean }[];
    email = emails.find((e) => e.primary && e.verified)?.email ?? emails.find((e) => e.verified)?.email;
  } catch { /* scope may be missing */ }
  const { uid } = await getUserId();
  const current = await getSessionAccount();
  const acc = await resolveAccount({ provider: "github", subject: me.login, email, name: me.login, avatar: me.avatar_url }, uid, current?.id);
  await mergeAnonymous(uid, acc);
  const res = NextResponse.redirect(`${home}?auth=ok`);
  res.cookies.set(sessionCookie({ token: tok.access_token, login: me.login, avatar: me.avatar_url, via: "oauth" }));
  for (const c of sessionCookies(acc)) res.cookies.set(c);
  res.cookies.delete(STATE_COOKIE);
  return res;
}
