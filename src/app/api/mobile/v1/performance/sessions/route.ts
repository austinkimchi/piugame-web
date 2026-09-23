import { NextResponse } from "next/server";

import { bearerTokenFromAuthorization } from "@/lib/mobile-auth-core";
import { authenticateMobileAccessToken } from "@/lib/mobile-auth";
import { getPerformanceSessions } from "@/lib/performance";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const accessToken = bearerTokenFromAuthorization(request.headers.get("authorization"));
  const identity = await authenticateMobileAccessToken(accessToken);
  if (!identity) {
    return NextResponse.json(
      { error: "invalid_token" },
      { status: 401, headers: noStoreHeaders() },
    );
  }

  const url = new URL(request.url);
  const offset = boundedInteger(url.searchParams.get("offset"), 0, 0, 1000);
  const limit = boundedInteger(url.searchParams.get("limit"), 20, 1, 50);
  const page = await getPerformanceSessions(identity.userId, { offset, limit: limit + 1 });
  const hasMore = page.length > limit;
  const sessions = page.slice(0, limit);
  return NextResponse.json(
    { sessions, nextOffset: hasMore ? offset + sessions.length : null },
    { headers: noStoreHeaders() },
  );
}

function boundedInteger(value: string | null, fallback: number, minimum: number, maximum: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) ? Math.min(maximum, Math.max(minimum, parsed)) : fallback;
}

function noStoreHeaders() {
  return { "Cache-Control": "private, no-store", Pragma: "no-cache" };
}
