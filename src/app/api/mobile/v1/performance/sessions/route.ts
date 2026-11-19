import { NextResponse } from "next/server";

import { bearerTokenFromAuthorization } from "@/lib/mobile-auth-core";
import { authenticateMobileAccessToken } from "@/lib/mobile-auth";
import { getPerformanceSessions } from "@/lib/performance";
import { sessionLimit, sessionOffset } from "@/lib/performance-session-pagination";

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
  const offset = sessionOffset(url.searchParams.get("offset"));
  const limit = sessionLimit(url.searchParams.get("limit"), 50);
  const page = await getPerformanceSessions(identity.userId, { offset, limit: limit + 1 });
  const hasMore = page.length > limit;
  const sessions = page.slice(0, limit);
  return NextResponse.json(
    { sessions, nextOffset: hasMore && Number.isSafeInteger(offset + sessions.length) ? offset + sessions.length : null },
    { headers: noStoreHeaders() },
  );
}

function noStoreHeaders() {
  return { "Cache-Control": "private, no-store", Pragma: "no-cache" };
}
