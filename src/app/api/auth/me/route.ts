import { NextResponse } from "next/server";
import { getSession, oauthConfigured } from "@/lib/github/auth";

export const dynamic = "force-dynamic";

export async function GET() {
  const s = await getSession();
  return NextResponse.json({
    oauth: oauthConfigured(),
    user: s ? { login: s.login, avatar: s.avatar, via: s.via } : null,
  });
}
