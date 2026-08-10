import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { getCurrentUserId } from "@/lib/auth";
import { publicRequestOrigin } from "@/lib/oauth-origin";
import { syncCurrentUserPerformance } from "@/lib/performance";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const userId = await getCurrentUserId();
    await syncCurrentUserPerformance(userId);
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
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Performance sync failed." },
      { status: 400 },
    );
  }
}

function wantsJson(request: NextRequest): boolean {
  return request.nextUrl.searchParams.get("response") === "json" || request.headers.get("accept")?.includes("application/json") === true;
}
