import { type NextRequest, NextResponse } from "next/server";

import { getCurrentUserId } from "@/lib/auth";
import {
  isAllowedMobileRedirectUri,
  isValidMobilePkceChallenge,
  normalizeMobileOAuthState,
} from "@/lib/mobile-auth-core";
import { createMobileAuthorizationCode, MobileAuthorizationError } from "@/lib/mobile-auth";
import { discordOAuthOrigin } from "@/lib/discord-oauth";
import { googleOAuthOrigin } from "@/lib/google-oauth";
import { publicRequestOrigin } from "@/lib/oauth-origin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CLIENT_IDS = new Set(["mypiu-ios", "mypiu-android"]);

export async function GET(request: NextRequest) {
  const clientId = request.nextUrl.searchParams.get("client_id");
  const redirectUri = request.nextUrl.searchParams.get("redirect_uri");
  const codeChallenge = request.nextUrl.searchParams.get("code_challenge");
  const codeChallengeMethod = request.nextUrl.searchParams.get("code_challenge_method");
  const state = normalizeMobileOAuthState(request.nextUrl.searchParams.get("state"));
  const providerValue = request.nextUrl.searchParams.get("provider");
  const provider = providerValue === "discord" ? "discord" : "google";

  if (
    !isMobileClientId(clientId) ||
    !isAllowedMobileRedirectUri(redirectUri) ||
    !isValidMobilePkceChallenge(codeChallenge) ||
    codeChallengeMethod !== "S256" ||
    !state ||
    (providerValue !== null && providerValue !== "google" && providerValue !== "discord")
  ) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400, headers: noStoreHeaders() });
  }

  const userId = await getCurrentUserId();
  if (!userId) {
    let publicOrigin: string;
    try {
      const requestOrigin = publicRequestOrigin(request.headers, request.nextUrl.origin);
      publicOrigin = provider === "discord" ? discordOAuthOrigin(requestOrigin) : googleOAuthOrigin(requestOrigin);
    } catch {
      return NextResponse.json({ error: "invalid_request" }, { status: 400, headers: noStoreHeaders() });
    }
    const loginUrl = new URL(`/api/auth/${provider}/login`, publicOrigin);
    loginUrl.searchParams.set("next", `${request.nextUrl.pathname}${request.nextUrl.search}`);
    return NextResponse.redirect(loginUrl, { headers: noStoreHeaders() });
  }

  let code: string;
  try {
    code = await createMobileAuthorizationCode({ userId, clientId, redirectUri, codeChallenge });
  } catch (error) {
    if (error instanceof MobileAuthorizationError) {
      const status = error.code === "temporarily_unavailable" ? 503 : 401;
      return NextResponse.json({ error: error.code }, { status, headers: noStoreHeaders() });
    }
    throw error;
  }
  const callbackUrl = new URL(redirectUri);
  callbackUrl.searchParams.set("code", code);
  callbackUrl.searchParams.set("state", state);
  return NextResponse.redirect(callbackUrl, { headers: noStoreHeaders() });
}

function noStoreHeaders() {
  return { "Cache-Control": "private, no-store" };
}

function isMobileClientId(value: string | null): value is "mypiu-ios" | "mypiu-android" {
  return value !== null && CLIENT_IDS.has(value);
}
