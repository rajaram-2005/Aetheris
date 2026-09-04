import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { requestOrigin } from "@/lib/github/auth";
import { googleConfigured } from "@/lib/auth/deliver";

export const dynamic = "force-dynamic";
const GOOGLE_STATE = "aetheris_g_state";

export async function GET(req: Request) {
  if (!googleConfigured()) return NextResponse.redirect(`${requestOrigin(req)}/login?error=${encodeURIComponent("Google sign-in is not configured (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET).")}`);
  const state = randomBytes(16).toString("hex");
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", process.env.GOOGLE_CLIENT_ID!);
  url.searchParams.set("redirect_uri", `${requestOrigin(req)}/api/auth/google/callback`);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "openid email profile");
  url.searchParams.set("state", state);
  url.searchParams.set("prompt", "select_account");
  const res = NextResponse.redirect(url);
  res.cookies.set(GOOGLE_STATE, state, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 600 });
  return res;
}
