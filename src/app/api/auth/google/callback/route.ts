import { cookies } from "next/headers";
import { type NextRequest, NextResponse } from "next/server";

import {
  OAUTH_NEXT_COOKIE_NAME,
  OAUTH_STATE_COOKIE_NAME,
  SESSION_COOKIE_NAME,
  createSession,
  sessionCookieOptions,
  upsertGoogleUser,
} from "@/lib/auth";
import { exchangeGoogleCode, googleOAuthOrigin } from "@/lib/google-oauth";
import { publicRequestOrigin } from "@/lib/oauth-origin";
import { safeInternalRedirectPath } from "@/lib/redirect-path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const publicOrigin = googleOAuthOrigin(publicRequestOrigin(request.headers, request.nextUrl.origin));
  const cookieStore = await cookies();
  const expectedState = cookieStore.get(OAUTH_STATE_COOKIE_NAME)?.value;
  const actualState = request.nextUrl.searchParams.get("state");
  const code = request.nextUrl.searchParams.get("code");
  const nextPath = cookieStore.get(OAUTH_NEXT_COOKIE_NAME)?.value ?? "/";

  cookieStore.delete(OAUTH_STATE_COOKIE_NAME);
  cookieStore.delete(OAUTH_NEXT_COOKIE_NAME);

  if (!code || !expectedState || expectedState !== actualState) {
    return NextResponse.redirect(new URL("/?auth=failed", publicOrigin));
  }

  try {
    const profile = await exchangeGoogleCode({ code, origin: publicOrigin });
    const user = await upsertGoogleUser(profile);
    const sessionToken = await createSession(user._id);
    cookieStore.set(SESSION_COOKIE_NAME, sessionToken, sessionCookieOptions());
    return NextResponse.redirect(new URL(safeInternalRedirectPath(nextPath), publicOrigin));
  } catch {
    return NextResponse.redirect(new URL("/?auth=failed", publicOrigin));
  }
}
