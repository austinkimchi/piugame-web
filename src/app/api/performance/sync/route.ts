import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { getCurrentUserId } from "@/lib/auth";
import { publicRequestOrigin } from "@/lib/oauth-origin";
import { fetchCurrentUserRecentPlays, syncCurrentUserPerformance, syncCurrentUserTopPlaysIfDue, syncQueuedAllPlaysBackfillForUser } from "@/lib/performance";
import { verifyPerformanceSyncToken } from "@/lib/performance-sync-token";
import { claimCooldown } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const userId = (await getCurrentUserId()) ?? userIdFromBearerToken(request);
    if (!userId) {
      return syncErrorResponse(request, "Sign in before syncing performance data.", 401);
    }

    if (!claimCooldown(`performance-sync:${userId}`, 10_000)) {
      return syncJsonOrRedirect(request, { ok: true, throttled: true });
    }

    if (request.nextUrl.searchParams.get("background") === "true") {
      const fresh = await fetchCurrentUserRecentPlays(userId);
      await fresh.persist();
    } else {
      await syncCurrentUserPerformance(userId);
    }
    await syncCurrentUserTopPlaysIfDue(userId).catch(() => undefined);
    await syncQueuedAllPlaysBackfillForUser(userId).catch(() => undefined);

    return syncJsonOrRedirect(request, { ok: true });
  } catch (error) {
    return syncErrorResponse(request, error instanceof Error ? error.message : "Performance sync failed.", 400);
  }
}

function syncJsonOrRedirect(request: NextRequest, body: { ok: true; throttled?: boolean }) {
  if (wantsJson(request)) {
    return NextResponse.json(body, { headers: { "Cache-Control": "private, no-store" } });
  }

  const publicOrigin = publicRequestOrigin(request.headers, request.nextUrl.origin);
  return NextResponse.redirect(new URL("/performance", publicOrigin), 303);
}

function wantsJson(request: NextRequest): boolean {
  return request.nextUrl.searchParams.get("response") === "json" || request.headers.get("accept")?.includes("application/json") === true;
}

function userIdFromBearerToken(request: NextRequest): string | null {
  const authorization = request.headers.get("authorization");
  const match = authorization?.match(/^Bearer\s+(.+)$/i);
  return verifyPerformanceSyncToken(match?.[1]);
}

function syncErrorResponse(request: NextRequest, message: string, status: number): NextResponse {
  if (wantsJson(request)) {
    return NextResponse.json({ error: message }, { status });
  }

  const publicOrigin = publicRequestOrigin(request.headers, request.nextUrl.origin);
  const redirectUrl = new URL("/performance", publicOrigin);
  redirectUrl.searchParams.set("syncError", message);
  return NextResponse.redirect(redirectUrl, 303);
}
