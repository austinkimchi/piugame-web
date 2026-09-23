import { type NextRequest, NextResponse } from "next/server";

import { getCurrentUserId } from "@/lib/auth";
import {
  appleAuthUrl,
  appleOAuthOrigin,
  createAppleOAuthState,
  hasAppleOAuthConfig,
} from "@/lib/apple-auth";
import { publicRequestOrigin } from "@/lib/oauth-origin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  if (!hasAppleOAuthConfig()) {
    return NextResponse.json({ error: "Sign in with Apple is not configured." }, { status: 503 });
  }

  const origin = appleOAuthOrigin(publicRequestOrigin(request.headers, request.nextUrl.origin));
  const linkUserId = await getCurrentUserId();
  const { state, nonce } = createAppleOAuthState({
    nextPath: request.nextUrl.searchParams.get("next") ?? "/",
    linkUserId,
  });
  return NextResponse.redirect(appleAuthUrl({ origin, state, nonce }));
}
