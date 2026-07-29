import { type NextRequest, NextResponse } from "next/server";

import { checkRateLimit } from "@/lib/rate-limit";
import { searchSongs } from "@/lib/catalog";
import type { PiuCatalogVersion } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function clientKey(request: NextRequest): string {
  const forwardedFor = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const userAgent = request.headers.get("user-agent") ?? "unknown";
  return `${forwardedFor ?? "local"}:${userAgent}`;
}

function parseVersion(value: string | null): PiuCatalogVersion | undefined {
  return value === "phoenix" || value === "phoenix2" ? value : undefined;
}

export async function GET(request: NextRequest) {
  if (!checkRateLimit(clientKey(request))) {
    return NextResponse.json({ error: "Too many requests. Try again shortly." }, { status: 429 });
  }

  const query = request.nextUrl.searchParams.get("q")?.trim() ?? "";
  if (query.length < 2) {
    return NextResponse.json({ error: "Search requires at least 2 characters." }, { status: 400 });
  }

  const limit = Number.parseInt(request.nextUrl.searchParams.get("limit") ?? "24", 10);
  const result = await searchSongs({
    query,
    version: parseVersion(request.nextUrl.searchParams.get("version")),
    cursor: request.nextUrl.searchParams.get("cursor"),
    limit: Number.isFinite(limit) ? limit : 24,
  });

  return NextResponse.json(result, {
    headers: {
      "Cache-Control": "private, no-store",
    },
  });
}
