import { NextResponse } from "next/server";

import {
  bearerTokenFromAuthorization,
  isAllowedMobileRedirectUri,
  isValidMobilePkceVerifier,
} from "@/lib/mobile-auth-core";
import {
  MobileAuthorizationError,
  exchangeMobileAuthorizationCode,
  revokeMobileAccessToken,
} from "@/lib/mobile-auth";
import { readRequestText, RequestBodyTooLargeError } from "@/lib/request-body";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CLIENT_NAMES = new Map([
  ["mypiu-ios", "MyPIU for iOS"],
  ["mypiu-android", "MyPIU for Android"],
]);
const MAX_TOKEN_REQUEST_BYTES = 16 * 1024;

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
      return oauthError(error.code, 400);
    }
    if (error instanceof MobileTokenRequestError) {
      return oauthError("invalid_request", 400);
    }
    return oauthError("server_error", 500);
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
