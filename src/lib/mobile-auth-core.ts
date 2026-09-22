import { createHash } from "node:crypto";

const PKCE_VERIFIER_PATTERN = /^[A-Za-z0-9._~-]{43,128}$/;
const PKCE_CHALLENGE_PATTERN = /^[A-Za-z0-9_-]{43,128}$/;

export function mobilePkceChallenge(verifier: string): string {
  return createHash("sha256").update(verifier, "ascii").digest("base64url");
}

export function isValidMobilePkceVerifier(value: unknown): value is string {
  return typeof value === "string" && PKCE_VERIFIER_PATTERN.test(value);
}

export function isValidMobilePkceChallenge(value: unknown): value is string {
  return typeof value === "string" && PKCE_CHALLENGE_PATTERN.test(value);
}

export function verifyMobilePkce(verifier: string, expectedChallenge: string): boolean {
  return isValidMobilePkceVerifier(verifier) && mobilePkceChallenge(verifier) === expectedChallenge;
}

export function allowedMobileRedirectUris(value = process.env.MOBILE_OAUTH_REDIRECT_URIS): Set<string> {
  const configured = String(value ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  return new Set(configured.length > 0 ? configured : ["mypiu://oauth/callback"]);
}

export function isAllowedMobileRedirectUri(value: unknown, allowed = allowedMobileRedirectUris()): value is string {
  if (typeof value !== "string" || !allowed.has(value)) {
    return false;
  }

  try {
    const url = new URL(value);
    return url.username === "" && url.password === "" && url.search === "" && url.hash === "";
  } catch {
    return false;
  }
}

export function normalizeMobileOAuthState(value: unknown): string | null {
  if (typeof value !== "string" || value.length < 16 || value.length > 256 || !/^[\x21-\x7e]+$/.test(value)) {
    return null;
  }
  return value;
}

export function bearerTokenFromAuthorization(value: string | null | undefined): string | null {
  const match = value?.match(/^Bearer\s+([^\s]+)$/i);
  return match?.[1] ?? null;
}
