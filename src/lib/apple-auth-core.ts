import { createPublicKey, sign, verify, type JsonWebKey } from "node:crypto";

export const APPLE_ISSUER = "https://appleid.apple.com";

interface AppleTokenHeader {
  alg?: string;
  kid?: string;
}

interface AppleTokenClaims {
  iss?: string;
  aud?: string | string[];
  sub?: string;
  exp?: number;
  iat?: number;
  nonce?: string;
  email?: string;
  email_verified?: boolean | string;
  is_private_email?: boolean | string;
}

export interface AppleJsonWebKey {
  kty: string;
  kid: string;
  use?: string;
  alg?: string;
  n: string;
  e: string;
}

export interface VerifiedAppleIdentity {
  appleId: string;
  email: string | null;
  emailVerified: boolean;
  privateEmail: boolean;
}

export function createAppleClientSecret(args: {
  clientId: string;
  teamId: string;
  keyId: string;
  privateKey: string;
  now?: Date;
}): string {
  const now = Math.floor((args.now ?? new Date()).getTime() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: "ES256", kid: args.keyId })).toString("base64url");
  const payload = Buffer.from(
    JSON.stringify({
      iss: args.teamId,
      iat: now,
      exp: now + 5 * 60,
      aud: APPLE_ISSUER,
      sub: args.clientId,
    }),
  ).toString("base64url");
  const signingInput = `${header}.${payload}`;
  const signature = sign("sha256", Buffer.from(signingInput), {
    key: args.privateKey,
    dsaEncoding: "ieee-p1363",
  }).toString("base64url");
  return `${signingInput}.${signature}`;
}

export function verifyAppleIdentityTokenWithKeys(args: {
  identityToken: string;
  expectedAudience: string;
  expectedNonce: string;
  keys: AppleJsonWebKey[];
  now?: Date;
}): VerifiedAppleIdentity {
  const parts = args.identityToken.split(".");
  if (parts.length !== 3) {
    throw new Error("Apple identity token was malformed.");
  }

  const header = decodeJson<AppleTokenHeader>(parts[0]);
  const claims = decodeJson<AppleTokenClaims>(parts[1]);
  if (header.alg !== "RS256" || !header.kid) {
    throw new Error("Apple identity token used an unsupported signature.");
  }
  const key = args.keys.find((candidate) => candidate.kid === header.kid && candidate.kty === "RSA");
  if (!key) {
    throw new Error("Apple identity signing key was not found.");
  }
  const publicKey = createPublicKey({ key: key as unknown as JsonWebKey, format: "jwk" });
  const validSignature = verify(
    "RSA-SHA256",
    Buffer.from(`${parts[0]}.${parts[1]}`),
    publicKey,
    decodeBase64Url(parts[2]),
  );
  if (!validSignature) {
    throw new Error("Apple identity token signature was invalid.");
  }

  const nowSeconds = Math.floor((args.now ?? new Date()).getTime() / 1000);
  const audiences = Array.isArray(claims.aud) ? claims.aud : claims.aud ? [claims.aud] : [];
  if (
    claims.iss !== APPLE_ISSUER ||
    !audiences.includes(args.expectedAudience) ||
    !claims.sub ||
    !claims.exp ||
    claims.exp <= nowSeconds ||
    !claims.iat ||
    claims.iat > nowSeconds + 5 * 60 ||
    claims.nonce !== args.expectedNonce
  ) {
    throw new Error("Apple identity token claims were invalid.");
  }

  return {
    appleId: claims.sub,
    email: typeof claims.email === "string" && claims.email.includes("@") ? claims.email.toLowerCase() : null,
    emailVerified: claims.email_verified === true || claims.email_verified === "true",
    privateEmail: claims.is_private_email === true || claims.is_private_email === "true",
  };
}

function decodeJson<T>(value: string): T {
  try {
    return JSON.parse(decodeBase64Url(value).toString("utf8")) as T;
  } catch {
    throw new Error("Apple identity token was malformed.");
  }
}

function decodeBase64Url(value: string): Buffer {
  return Buffer.from(value, "base64url");
}
