import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { getCurrentUserId } from "@/lib/auth";
import { syncCurrentUserPerformance } from "@/lib/performance";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const userId = await getCurrentUserId();
    await syncCurrentUserPerformance(userId);
    return NextResponse.redirect(new URL("/performance", request.url), 303);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Performance sync failed." },
      { status: 400 },
    );
  }
}
