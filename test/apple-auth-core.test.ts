import assert from "node:assert/strict";
import { generateKeyPairSync, sign, verify } from "node:crypto";
import test from "node:test";

import {
  APPLE_ISSUER,
  createAppleClientSecret,
  verifyAppleIdentityTokenWithKeys,
} from "../src/lib/apple-auth-core.ts";

test("Apple client secrets use a verifiable ES256 JOSE signature", () => {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const now = new Date("2026-09-23T12:00:00Z");
  const token = createAppleClientSecret({
    clientId: "com.example.mypiu.web",
    teamId: "TEAM123456",
    keyId: "KEY1234567",
    privateKey: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    now,
  });
  const [header, payload, signature] = token.split(".");
  assert.deepEqual(JSON.parse(Buffer.from(header, "base64url").toString()), {
    alg: "ES256",
    kid: "KEY1234567",
  });
  assert.deepEqual(JSON.parse(Buffer.from(payload, "base64url").toString()), {
    iss: "TEAM123456",
    iat: Math.floor(now.getTime() / 1000),
    exp: Math.floor(now.getTime() / 1000) + 300,
    aud: APPLE_ISSUER,
    sub: "com.example.mypiu.web",
  });
  assert.equal(
    verify(
      "sha256",
      Buffer.from(`${header}.${payload}`),
      { key: publicKey, dsaEncoding: "ieee-p1363" },
      Buffer.from(signature, "base64url"),
    ),
    true,
  );
});

test("Apple identity tokens require a trusted signature, audience, and nonce", () => {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const kid = "test-key";
  const audience = "com.example.mypiu.web";
  const nonce = "hashed-nonce";
  const now = new Date("2026-09-23T12:00:00Z");
  const token = signedToken(
    {
      iss: APPLE_ISSUER,
      aud: audience,
      sub: "apple-user-123",
      iat: Math.floor(now.getTime() / 1000),
      exp: Math.floor(now.getTime() / 1000) + 300,
      nonce,
      email: "PLAYER@EXAMPLE.COM",
      email_verified: "true",
      is_private_email: "false",
    },
    kid,
    privateKey,
  );
  const jwk = publicKey.export({ format: "jwk" });
  const keys = [{ ...jwk, kid, kty: "RSA", n: jwk.n!, e: jwk.e! }];

  assert.deepEqual(
    verifyAppleIdentityTokenWithKeys({
      identityToken: token,
      expectedAudience: audience,
      expectedNonce: nonce,
      keys,
      now,
    }),
    {
      appleId: "apple-user-123",
      email: "player@example.com",
      emailVerified: true,
      privateEmail: false,
    },
  );
  assert.throws(() =>
    verifyAppleIdentityTokenWithKeys({
      identityToken: token,
      expectedAudience: audience,
      expectedNonce: "different-nonce",
      keys,
      now,
    }),
  );
});

function signedToken(payload: object, kid: string, privateKey: ReturnType<typeof generateKeyPairSync>["privateKey"]): string {
  const header = Buffer.from(JSON.stringify({ alg: "RS256", kid })).toString("base64url");
  const claims = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = sign("RSA-SHA256", Buffer.from(`${header}.${claims}`), privateKey).toString("base64url");
  return `${header}.${claims}.${signature}`;
}
