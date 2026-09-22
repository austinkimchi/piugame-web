import assert from "node:assert/strict";
import test from "node:test";

import {
  bearerTokenFromAuthorization,
  isAllowedMobileRedirectUri,
  isValidMobilePkceChallenge,
  isValidMobilePkceVerifier,
  mobilePkceChallenge,
  normalizeMobileOAuthState,
  verifyMobilePkce,
} from "../src/lib/mobile-auth-core.ts";

const RFC_7636_VERIFIER = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
const RFC_7636_CHALLENGE = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";

test("PKCE uses the RFC 7636 S256 transformation", () => {
  assert.equal(mobilePkceChallenge(RFC_7636_VERIFIER), RFC_7636_CHALLENGE);
  assert.equal(verifyMobilePkce(RFC_7636_VERIFIER, RFC_7636_CHALLENGE), true);
  assert.equal(verifyMobilePkce(`${RFC_7636_VERIFIER}x`, RFC_7636_CHALLENGE), false);
  assert.equal(isValidMobilePkceVerifier(RFC_7636_VERIFIER), true);
  assert.equal(isValidMobilePkceChallenge(RFC_7636_CHALLENGE), true);
});

test("mobile redirects require an exact allowlisted URI", () => {
  const allowed = new Set(["mypiu://oauth/callback"]);
  assert.equal(isAllowedMobileRedirectUri("mypiu://oauth/callback", allowed), true);
  assert.equal(isAllowedMobileRedirectUri("mypiu://oauth/callback?next=https://evil.example", allowed), false);
  assert.equal(isAllowedMobileRedirectUri("https://evil.example/callback", allowed), false);
});

test("OAuth state and bearer token parsing reject ambiguous input", () => {
  assert.equal(normalizeMobileOAuthState("state-0123456789abcdef"), "state-0123456789abcdef");
  assert.equal(normalizeMobileOAuthState("short"), null);
  assert.equal(bearerTokenFromAuthorization("Bearer mypiu_token"), "mypiu_token");
  assert.equal(bearerTokenFromAuthorization("Bearer token with-spaces"), null);
  assert.equal(bearerTokenFromAuthorization("Basic mypiu_token"), null);
});
