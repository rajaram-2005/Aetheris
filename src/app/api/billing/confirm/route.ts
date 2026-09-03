import { NextResponse } from "next/server";
import { getUserId } from "@/lib/user";
import { submitUtr } from "@/lib/billing/payments";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const { uid } = await getUserId();
  const { id, utr } = (await req.json().catch(() => ({}))) as { id?: string; utr?: string };
  if (!id || !utr) return NextResponse.json({ error: "id and utr required" }, { status: 400 });
  try {
    return NextResponse.json(await submitUtr(uid, id, utr));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
