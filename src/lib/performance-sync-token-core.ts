import { createHmac, timingSafeEqual } from "node:crypto";

const TOKEN_TTL_SECONDS = 5 * 60;

interface SyncTokenPayload {
  exp: number;
  purpose: "performance-sync";
  sub: string;
}

export function createPerformanceSyncTokenWithSecret(userId: string, secret: string): string {
  const payload: SyncTokenPayload = {
    exp: Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS,
    purpose: "performance-sync",
    sub: userId,
  };
  const encodedPayload = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${encodedPayload}.${sign(encodedPayload, secret)}`;
}

export function verifyPerformanceSyncTokenWithSecret(token: string | null | undefined, secret: string): string | null {
  if (!token) {
    return null;
  }

  const [encodedPayload, signature, extra] = token.split(".");
  if (!encodedPayload || !signature || extra) {
    return null;
  }

  if (!secureEqual(signature, sign(encodedPayload, secret))) {
    return null;
  }

  const payload = parsePayload(encodedPayload);
  if (!payload || payload.purpose !== "performance-sync" || payload.exp < Math.floor(Date.now() / 1000)) {
    return null;
  }

  return payload.sub;
}

function parsePayload(encodedPayload: string): SyncTokenPayload | null {
  try {
    const parsed = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8")) as Partial<SyncTokenPayload>;
    return typeof parsed.sub === "string" && typeof parsed.exp === "number" && parsed.purpose === "performance-sync"
      ? { exp: parsed.exp, purpose: parsed.purpose, sub: parsed.sub }
      : null;
  } catch {
    return null;
  }
}

function sign(value: string, secret: string): string {
  return createHmac("sha256", secret).update(value).digest("base64url");
}

function secureEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}
