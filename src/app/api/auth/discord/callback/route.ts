import { cookies } from "next/headers";
import { type NextRequest, NextResponse } from "next/server";

import {
  OAUTH_NEXT_COOKIE_NAME,
  OAUTH_STATE_COOKIE_NAME,
  SESSION_COOKIE_NAME,
  createSession,
  getCurrentUserId,
  sessionCookieOptions,
  upsertDiscordUser,
} from "@/lib/auth";
import { discordOAuthOrigin, exchangeDiscordCode } from "@/lib/discord-oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const publicOrigin = discordOAuthOrigin(request.nextUrl.origin);
  const cookieStore = await cookies();
  const expectedState = cookieStore.get(OAUTH_STATE_COOKIE_NAME)?.value;
  const actualState = request.nextUrl.searchParams.get("state");
  const code = request.nextUrl.searchParams.get("code");
  const nextPath = cookieStore.get(OAUTH_NEXT_COOKIE_NAME)?.value ?? "/";
  const existingUserId = await getCurrentUserId();

  cookieStore.delete(OAUTH_STATE_COOKIE_NAME);
  cookieStore.delete(OAUTH_NEXT_COOKIE_NAME);

  if (!code || !expectedState || expectedState !== actualState) {
    return NextResponse.redirect(new URL("/?auth=failed", publicOrigin));
  }

  try {
    const profile = await exchangeDiscordCode({ code, origin: publicOrigin });
    const user = await upsertDiscordUser(profile, existingUserId ?? undefined);
    const sessionToken = await createSession(user._id);
    cookieStore.set(SESSION_COOKIE_NAME, sessionToken, sessionCookieOptions());
    return NextResponse.redirect(new URL(safeNextPath(nextPath), publicOrigin));
  } catch {
    return NextResponse.redirect(new URL("/?auth=failed", publicOrigin));
  }
}

function safeNextPath(value: string): string {
  if (!value.startsWith("/") || value.startsWith("//")) {
    return "/";
  }
  return value;
}
