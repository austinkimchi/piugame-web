import { NextResponse } from "next/server";

import {
  bearerTokenFromAuthorization,
  isAllowedMobileRedirectUri,
  isValidMobilePkceVerifier,
} from "@/lib/mobile-auth-core";
import {
  MobileAuthorizationError,
  exchangeMobileAuthorizationCode,
  issueMobileAccessToken,
  revokeMobileAccessToken,
} from "@/lib/mobile-auth";
import { verifyAppleNativeIdentityToken } from "@/lib/apple-auth";
import { upsertAppleUser } from "@/lib/auth";
import { readRequestText, RequestBodyTooLargeError } from "@/lib/request-body";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CLIENT_NAMES = new Map([
  ["mypiu-ios", "MyPIU for iOS"],
  ["mypiu-android", "MyPIU for Android"],
]);
const MAX_TOKEN_REQUEST_BYTES = 16 * 1024;
const APPLE_TOKEN_EXCHANGE_GRANT = "urn:ietf:params:oauth:grant-type:token-exchange";
const ID_TOKEN_TYPE = "urn:ietf:params:oauth:token-type:id_token";

export async function POST(request: Request) {
  try {
    const body = await tokenRequestBody(request);
    const grantType = stringValue(body.grant_type);
    const clientId = stringValue(body.client_id);
    const code = stringValue(body.code);
    const codeVerifier = stringValue(body.code_verifier);
    const redirectUri = stringValue(body.redirect_uri);
    const installationId = stringValue(body.installation_id);
    const appVersion = optionalStringValue(body.app_version, 40);
    const clientName = clientId ? CLIENT_NAMES.get(clientId) : null;
    const mobileClientId = clientId === "mypiu-ios" || clientId === "mypiu-android" ? clientId : null;
    const platform = mobileClientId === "mypiu-ios" ? "ios" : mobileClientId === "mypiu-android" ? "android" : null;

    if (grantType === APPLE_TOKEN_EXCHANGE_GRANT) {
      return exchangeAppleToken({ body, clientId, installationId, appVersion });
    }

    if (
      grantType !== "authorization_code" ||
      !mobileClientId ||
      !clientName ||
      !platform ||
      !code ||
      code.length > 256 ||
      !isValidMobilePkceVerifier(codeVerifier) ||
      !isAllowedMobileRedirectUri(redirectUri) ||
      !installationId ||
      !/^[A-Za-z0-9._:-]{8,128}$/.test(installationId)
    ) {
      return oauthError("invalid_request", 400);
    }

    const result = await exchangeMobileAuthorizationCode({
      code,
      clientId: mobileClientId,
      codeVerifier,
      redirectUri,
      installationId,
      clientName,
      platform,
      appVersion,
    });
    return NextResponse.json(
      {
        access_token: result.accessToken,
        token_type: "Bearer",
        expires_in: result.expiresIn,
      },
      { headers: noStoreHeaders() },
    );
  } catch (error) {
    if (error instanceof MobileAuthorizationError) {
      return oauthError(error.code, error.code === "temporarily_unavailable" ? 503 : 400);
    }
    if (error instanceof MobileTokenRequestError) {
      return oauthError("invalid_request", 400);
    }
    return oauthError("server_error", 500);
  }
}

async function exchangeAppleToken(args: {
  body: Record<string, unknown>;
  clientId: string | null;
  installationId: string | null;
  appVersion: string | null;
}) {
  const subjectTokenType = stringValue(args.body.subject_token_type);
  const identityToken = stringValue(args.body.subject_token);
  const nonce = stringValue(args.body.nonce);
  const firstName = optionalStringValue(args.body.first_name, 80);
  const lastName = optionalStringValue(args.body.last_name, 80);
  if (
    args.clientId !== "mypiu-ios" ||
    subjectTokenType !== ID_TOKEN_TYPE ||
    !identityToken ||
    identityToken.length > 8_192 ||
    !nonce ||
    !/^[A-Za-z0-9_-]{32,128}$/.test(nonce) ||
    !args.installationId ||
    !/^[A-Za-z0-9._:-]{8,128}$/.test(args.installationId)
  ) {
    return oauthError("invalid_request", 400);
  }

  try {
    const identity = await verifyAppleNativeIdentityToken(identityToken, nonce);
    const name = [firstName, lastName].filter(Boolean).join(" ").replace(/\s+/g, " ").trim() || null;
    const user = await upsertAppleUser({
      appleId: identity.appleId,
      email: identity.email,
      emailVerified: identity.emailVerified,
      name,
    });
    const result = await issueMobileAccessToken({
      userId: user._id.toHexString(),
      clientId: "mypiu-ios",
      installationId: args.installationId,
      clientName: "MyPIU for iOS",
      platform: "ios",
      appVersion: args.appVersion,
    });
    return NextResponse.json(
      { access_token: result.accessToken, token_type: "Bearer", expires_in: result.expiresIn },
      { headers: noStoreHeaders() },
    );
  } catch (error) {
    if (error instanceof MobileAuthorizationError) {
      throw error;
    }
    return oauthError("invalid_grant", 400);
  }
}

export async function DELETE(request: Request) {
  const accessToken = bearerTokenFromAuthorization(request.headers.get("authorization"));
  if (!accessToken) {
    return oauthError("invalid_token", 401);
  }

  await revokeMobileAccessToken(accessToken);
  return new NextResponse(null, { status: 204, headers: noStoreHeaders() });
}

async function tokenRequestBody(request: Request): Promise<Record<string, unknown>> {
  let text: string;
  try {
    text = await readRequestText(request, MAX_TOKEN_REQUEST_BYTES);
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      throw new MobileTokenRequestError();
    }
    throw error;
  }

  if (request.headers.get("content-type")?.includes("application/json")) {
    let value: unknown;
    try {
      value = JSON.parse(text) as unknown;
    } catch {
      throw new MobileTokenRequestError();
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new MobileTokenRequestError();
    }
    return value as Record<string, unknown>;
  }

  return Object.fromEntries(new URLSearchParams(text));
}

class MobileTokenRequestError extends Error {}

function stringValue(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function optionalStringValue(value: unknown, maxLength: number): string | null {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  return typeof value === "string" && value.length <= maxLength ? value : null;
}

function oauthError(error: string, status: number) {
  return NextResponse.json({ error }, { status, headers: noStoreHeaders() });
}

function noStoreHeaders() {
  return { "Cache-Control": "private, no-store", Pragma: "no-cache" };
}
