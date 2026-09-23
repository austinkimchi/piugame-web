import "server-only";

import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import {
  type AppleJsonWebKey,
  type VerifiedAppleIdentity,
  createAppleClientSecret,
  verifyAppleIdentityTokenWithKeys,
} from "@/lib/apple-auth-core";
import { resolveOAuthOrigin } from "@/lib/oauth-origin";
import { safeInternalRedirectPath } from "@/lib/redirect-path";

const APPLE_AUTHORIZATION_URL = "https://appleid.apple.com/auth/authorize";
const APPLE_JWKS_URL = "https://appleid.apple.com/auth/keys";
const APPLE_STATE_TTL_SECONDS = 10 * 60;
const APPLE_JWKS_TTL_MS = 6 * 60 * 60 * 1000;

export const APPLE_OAUTH_STATE_COOKIE_NAME = "piu_apple_oauth_state";

interface AppleOAuthState {
  nonce: string;
  next: string;
  linkUserId: string | null;
  expiresAt: number;
}

interface AppleJwksResponse {
  keys?: AppleJsonWebKey[];
}

interface AppleTokenResponse {
  id_token?: string;
  error?: string;
  error_description?: string;
}

declare global {
  var appleJwksCache: { keys: AppleJsonWebKey[]; expiresAt: number } | undefined;
}

export function hasAppleOAuthConfig(): boolean {
  return Boolean(
    process.env.APPLE_WEB_CLIENT_ID?.trim() &&
      process.env.APPLE_TEAM_ID?.trim() &&
      process.env.APPLE_KEY_ID?.trim() &&
      process.env.APPLE_PRIVATE_KEY?.trim() &&
      validAppleStateSecret(),
  );
}

export function appleOAuthOrigin(fallbackOrigin: string): string {
  return resolveOAuthOrigin({ fallbackOrigin, override: process.env.APPLE_OAUTH_ORIGIN });
}

export function appleAuthUrl(args: { origin: string; state: string; nonce: string }): string {
  const params = new URLSearchParams({
    client_id: requireAppleEnv("APPLE_WEB_CLIENT_ID"),
    redirect_uri: `${args.origin}/api/auth/apple/callback`,
    response_type: "code id_token",
    response_mode: "form_post",
    scope: "name email",
    state: args.state,
    nonce: appleNonceHash(args.nonce),
  });
  return `${APPLE_AUTHORIZATION_URL}?${params.toString()}`;
}

export function createAppleOAuthState(args: { nextPath: string; linkUserId: string | null }): {
  state: string;
  nonce: string;
} {
  const payload: AppleOAuthState = {
    nonce: randomBytes(32).toString("base64url"),
    next: safeInternalRedirectPath(args.nextPath),
    linkUserId: args.linkUserId,
    expiresAt: Math.floor(Date.now() / 1000) + APPLE_STATE_TTL_SECONDS,
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = signAppleState(encoded);
  return { state: `${encoded}.${signature}`, nonce: payload.nonce };
}

export function verifyAppleOAuthState(value: string): AppleOAuthState {
  const [encoded, signature, ...rest] = value.split(".");
  if (!encoded || !signature || rest.length > 0) {
    throw new Error("Apple sign-in state was malformed.");
  }
  const expected = Buffer.from(signAppleState(encoded), "base64url");
  const actual = Buffer.from(signature, "base64url");
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    throw new Error("Apple sign-in state was invalid.");
  }
  let payload: AppleOAuthState;
  try {
    payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as AppleOAuthState;
  } catch {
    throw new Error("Apple sign-in state was malformed.");
  }
  if (
    typeof payload.nonce !== "string" ||
    payload.nonce.length < 32 ||
    typeof payload.next !== "string" ||
    (payload.linkUserId !== null && typeof payload.linkUserId !== "string") ||
    typeof payload.expiresAt !== "number" ||
    payload.expiresAt <= Math.floor(Date.now() / 1000)
  ) {
    throw new Error("Apple sign-in state expired or was invalid.");
  }
  return { ...payload, next: safeInternalRedirectPath(payload.next) };
}

export async function exchangeAppleWebCode(args: {
  code: string;
  origin: string;
  nonce: string;
}): Promise<VerifiedAppleIdentity> {
  const clientId = requireAppleEnv("APPLE_WEB_CLIENT_ID");
  const response = await fetch("https://appleid.apple.com/auth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: appleClientSecret(clientId),
      code: args.code,
      grant_type: "authorization_code",
      redirect_uri: `${args.origin}/api/auth/apple/callback`,
    }),
    cache: "no-store",
  });
  const body = (await response.json()) as AppleTokenResponse;
  if (!response.ok || !body.id_token) {
    throw new Error(body.error_description || body.error || "Apple authorization code exchange failed.");
  }
  return verifyAppleIdentityToken(body.id_token, clientId, args.nonce);
}

export async function verifyAppleNativeIdentityToken(identityToken: string, nonce: string): Promise<VerifiedAppleIdentity> {
  const audience = process.env.APPLE_NATIVE_CLIENT_ID?.trim() || "com.austinkimchi.mypiu";
  return verifyAppleIdentityToken(identityToken, audience, nonce);
}

export function appleNonceHash(nonce: string): string {
  return createHash("sha256").update(nonce).digest("hex");
}

async function verifyAppleIdentityToken(identityToken: string, audience: string, nonce: string) {
  let keys = await appleSigningKeys(false);
  try {
    return verifyAppleIdentityTokenWithKeys({
      identityToken,
      expectedAudience: audience,
      expectedNonce: appleNonceHash(nonce),
      keys,
    });
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes("signing key was not found")) {
      throw error;
    }
    keys = await appleSigningKeys(true);
    return verifyAppleIdentityTokenWithKeys({
      identityToken,
      expectedAudience: audience,
      expectedNonce: appleNonceHash(nonce),
      keys,
    });
  }
}

async function appleSigningKeys(forceRefresh: boolean): Promise<AppleJsonWebKey[]> {
  const cached = globalThis.appleJwksCache;
  if (!forceRefresh && cached && cached.expiresAt > Date.now()) {
    return cached.keys;
  }
  const response = await fetch(APPLE_JWKS_URL, { cache: "no-store" });
  const body = (await response.json()) as AppleJwksResponse;
  if (!response.ok || !Array.isArray(body.keys) || body.keys.length === 0) {
    throw new Error("Apple signing keys could not be loaded.");
  }
  globalThis.appleJwksCache = { keys: body.keys, expiresAt: Date.now() + APPLE_JWKS_TTL_MS };
  return body.keys;
}

function signAppleState(value: string): string {
  return createHmac("sha256", requireAppleEnv("APPLE_OAUTH_STATE_SECRET")).update(value).digest("base64url");
}

function validAppleStateSecret(): boolean {
  return (process.env.APPLE_OAUTH_STATE_SECRET?.trim().length ?? 0) >= 32;
}

function appleClientSecret(clientId: string): string {
  return createAppleClientSecret({
    clientId,
    teamId: requireAppleEnv("APPLE_TEAM_ID"),
    keyId: requireAppleEnv("APPLE_KEY_ID"),
    privateKey: requireAppleEnv("APPLE_PRIVATE_KEY").replace(/\\n/g, "\n"),
  });
}

function requireAppleEnv(key: "APPLE_WEB_CLIENT_ID" | "APPLE_OAUTH_STATE_SECRET" | "APPLE_TEAM_ID" | "APPLE_KEY_ID" | "APPLE_PRIVATE_KEY"): string {
  const value = process.env[key]?.trim();
  if (!value || (key === "APPLE_OAUTH_STATE_SECRET" && value.length < 32)) {
    throw new Error(`Missing or invalid ${key}`);
  }
  return value;
}
