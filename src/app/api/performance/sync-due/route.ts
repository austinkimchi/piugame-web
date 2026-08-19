import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { syncDuePerformanceUsers } from "@/lib/performance";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await syncDuePerformanceUsers();
  return NextResponse.json(result);
}

function isAuthorized(request: NextRequest): boolean {
  const secret = process.env.PERFORMANCE_SYNC_SECRET?.trim();
  if (!secret && process.env.NODE_ENV !== "production") {
    return true;
  }

  const authorization = request.headers.get("authorization");
  return Boolean(secret && authorization === `Bearer ${secret}`);
}
