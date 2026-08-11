import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { after } from "next/server";

import { getCurrentUserId } from "@/lib/auth";
import { publicRequestOrigin } from "@/lib/oauth-origin";
import { syncCurrentUserPerformance, syncCurrentUserTopPlaysIfDue, syncQueuedAllPlaysBackfillForUser } from "@/lib/performance";
import { verifyPerformanceSyncToken } from "@/lib/performance-sync-token";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const userId = (await getCurrentUserId()) ?? userIdFromBearerToken(request);
    if (!userId) {
      return syncErrorResponse(request, "Sign in before syncing performance data.", 401);
    }

    await syncCurrentUserPerformance(userId);
    after(() => {
      void syncCurrentUserTopPlaysIfDue(userId).catch(() => undefined);
      void syncQueuedAllPlaysBackfillForUser(userId).catch(() => undefined);
    });

    if (wantsJson(request)) {
      return NextResponse.json(
        { ok: true },
        {
          headers: { "Cache-Control": "private, no-store" },
        },
      );
    }

    const publicOrigin = publicRequestOrigin(request.headers, request.nextUrl.origin);
    return NextResponse.redirect(new URL("/performance", publicOrigin), 303);
  } catch (error) {
    return syncErrorResponse(request, error instanceof Error ? error.message : "Performance sync failed.", 400);
  }
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
