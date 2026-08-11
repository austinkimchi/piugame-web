import "server-only";

import { createPerformanceSyncTokenWithSecret, verifyPerformanceSyncTokenWithSecret } from "@/lib/performance-sync-token-core";

export function createPerformanceSyncToken(userId: string): string {
  return createPerformanceSyncTokenWithSecret(userId, tokenSecret());
}

export function verifyPerformanceSyncToken(token: string | null | undefined): string | null {
  return verifyPerformanceSyncTokenWithSecret(token, tokenSecret());
}

function tokenSecret(): string {
  const secret = process.env.PERFORMANCE_SYNC_TOKEN_SECRET?.trim() || process.env.CREDENTIAL_ENCRYPTION_KEY?.trim();
  if (!secret) {
    throw new Error("Missing PERFORMANCE_SYNC_TOKEN_SECRET or CREDENTIAL_ENCRYPTION_KEY.");
  }
  return secret;
}
