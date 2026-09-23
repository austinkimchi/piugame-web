import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { type NextRequest, NextResponse } from "next/server";

import { OAUTH_NEXT_COOKIE_NAME, OAUTH_STATE_COOKIE_NAME } from "@/lib/auth";
import { discordAuthUrl, discordOAuthOrigin, hasDiscordOAuthConfig } from "@/lib/discord-oauth";
import { publicRequestOrigin } from "@/lib/oauth-origin";
import { safeInternalRedirectPath } from "@/lib/redirect-path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  if (!hasDiscordOAuthConfig()) {
    return NextResponse.json({ error: "Discord OAuth is not configured." }, { status: 503 });
  }

  const origin = discordOAuthOrigin(publicRequestOrigin(request.headers, request.nextUrl.origin));
  const state = randomBytes(24).toString("base64url");
  const nextPath = safeInternalRedirectPath(request.nextUrl.searchParams.get("next"));
  const cookieStore = await cookies();
  cookieStore.set(OAUTH_STATE_COOKIE_NAME, state, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 10,
  });
  cookieStore.set(OAUTH_NEXT_COOKIE_NAME, nextPath, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 10,
  });

  return NextResponse.redirect(discordAuthUrl({ origin, state }));
}
