const WINDOW_MS = 60_000;
const MAX_REQUESTS = 60;

interface RateBucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, RateBucket>();

export function checkRateLimit(key: string): boolean {
  const now = Date.now();
  const current = buckets.get(key);

  if (!current || current.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return true;
  }

  if (current.count >= MAX_REQUESTS) {
    return false;
  }

  current.count += 1;
  return true;
}

const cooldowns = new Map<string, number>();

/** Returns true only for the first request in a cooldown window. */
export function claimCooldown(key: string, cooldownMs: number): boolean {
  const now = Date.now();
  const nextAllowedAt = cooldowns.get(key) ?? 0;
  if (nextAllowedAt > now) {
    return false;
  }

  cooldowns.set(key, now + cooldownMs);
  return true;
}
