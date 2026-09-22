import { NextResponse } from "next/server";

import { bearerTokenFromAuthorization } from "@/lib/mobile-auth-core";
import { authenticateMobileAccessToken, getMobileAccountSnapshot } from "@/lib/mobile-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const accessToken = bearerTokenFromAuthorization(request.headers.get("authorization"));
  const identity = await authenticateMobileAccessToken(accessToken);
  if (!identity) {
    return NextResponse.json({ error: "invalid_token" }, { status: 401, headers: noStoreHeaders() });
  }

  const account = await getMobileAccountSnapshot(identity.userId);
  if (!account) {
    return NextResponse.json({ error: "account_not_found" }, { status: 404, headers: noStoreHeaders() });
  }

  return NextResponse.json({ account }, { headers: noStoreHeaders() });
}

function noStoreHeaders() {
  return { "Cache-Control": "private, no-store" };
}
