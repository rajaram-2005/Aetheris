import { timingSafeEqual } from "node:crypto";

/** Admin auth: Bearer token or ?key= matching AETHERIS_ADMIN_KEY. */
export function isAdmin(req: Request): boolean {
  const expected = process.env.AETHERIS_ADMIN_KEY;
  if (!expected) return false;
  const h = req.headers.get("authorization") ?? "";
  const given = h.startsWith("Bearer ") ? h.slice(7) : new URL(req.url).searchParams.get("key") ?? "";
  if (given.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(given), Buffer.from(expected));
}
