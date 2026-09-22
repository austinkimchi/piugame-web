import { NextResponse } from "next/server";

import { bearerTokenFromAuthorization } from "@/lib/mobile-auth-core";
import { authenticateMobileAccessToken } from "@/lib/mobile-auth";
import { getLatestPerformanceSession } from "@/lib/performance";

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

  const session = await getLatestPerformanceSession(identity.userId);
  return NextResponse.json({ session }, { headers: noStoreHeaders() });
}

function noStoreHeaders() {
  return { "Cache-Control": "private, no-store", Pragma: "no-cache" };
}
