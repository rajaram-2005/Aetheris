import { cookies } from "next/headers";
import { randomBytes } from "node:crypto";

export const UID_COOKIE = "aetheris_uid";

/** Anonymous per-browser user id. Created lazily; returned with a flag if it must be set. */
export async function getUserId(): Promise<{ uid: string; isNew: boolean }> {
  const jar = await cookies();
  const existing = jar.get(UID_COOKIE)?.value;
  if (existing && /^[a-f0-9]{32}$/.test(existing)) return { uid: existing, isNew: false };
  return { uid: randomBytes(16).toString("hex"), isNew: true };
}

export function uidCookie(uid: string) {
  return {
    name: UID_COOKIE,
    value: uid,
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  };
}
