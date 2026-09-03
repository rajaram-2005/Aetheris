import { NextResponse } from "next/server";
import { CATEGORIES, CONNECTORS } from "@/lib/mcp/catalog";

export async function GET() {
  return NextResponse.json({
    categories: CATEGORIES,
    connectors: CONNECTORS.map((c) => ({
      ...c,
      /** "verified" = official/known remote endpoint; "community" = placeholder URL until a host is configured. */
      status: c.url.includes(".example.com") ? "community" : "verified",
    })),
  });
}
