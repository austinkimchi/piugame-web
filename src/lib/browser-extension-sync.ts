export interface BrowserExtensionReady {
  version: string;
}

export type BrowserExtensionSyncResult =
  | {
      ok: true;
      importedRecentPlays: number;
      duplicateRecentPlays: number;
      duplicateRequest: boolean;
    }
  | {
      ok: false;
      error: string;
      recovery: { kind: "mypiu" | "piugame"; url: string } | null;
    };

const ALLOWED_RECOVERY_ORIGINS = new Set([
  "https://mypiu.austin.kim",
  "https://www.piugame.com",
  "https://phoenix.piugame.com",
]);
const CORRELATED_SYNC_MINIMUM_VERSION = [0, 2, 1];

export function parseExtensionReady(value: unknown): BrowserExtensionReady | null {
  if (!isRecord(value) || typeof value.version !== "string" || !isManifestVersion(value.version)) {
    return null;
  }
  return { version: value.version };
}

export function extensionSupportsCorrelatedSync(version: string): boolean {
  if (!isManifestVersion(version)) return false;
  const parts = version.split(".").map(Number);
  for (let index = 0; index < CORRELATED_SYNC_MINIMUM_VERSION.length; index += 1) {
    const part = parts[index] ?? 0;
    const minimum = CORRELATED_SYNC_MINIMUM_VERSION[index];
    if (part !== minimum) return part > minimum;
  }
  return true;
}

export function parseExtensionSyncResult(value: unknown, requestId: string): BrowserExtensionSyncResult | null {
  if (!isRecord(value) || value.requestId !== requestId || typeof value.ok !== "boolean") {
    return null;
  }
  if (value.ok) {
    if (
      !isNonnegativeInteger(value.importedRecentPlays)
      || !isNonnegativeInteger(value.duplicateRecentPlays)
      || typeof value.duplicateRequest !== "boolean"
    ) {
      return null;
    }
    return {
      ok: true,
      importedRecentPlays: value.importedRecentPlays,
      duplicateRecentPlays: value.duplicateRecentPlays,
      duplicateRequest: value.duplicateRequest,
    };
  }

  const recovery = parseRecovery(value.recovery);
  return {
    ok: false,
    error: typeof value.error === "string" && value.error.trim() ? value.error.trim() : "Browser sync failed.",
    recovery,
  };
}

export function serverSyncSuccessMessage(throttled: boolean): string {
  return throttled
    ? "A server refresh was recently requested. Retry in a few seconds if data is still stale."
    : "Server refresh complete.";
}

export function browserSyncSuccessMessage(result: Extract<BrowserExtensionSyncResult, { ok: true }>): string {
  if (result.duplicateRequest) {
    return "This sync was already saved.";
  }
  return `${result.importedRecentPlays} new ${plural(result.importedRecentPlays, "play")}, ${result.duplicateRecentPlays} already saved.`;
}

function parseRecovery(value: unknown): { kind: "mypiu" | "piugame"; url: string } | null {
  if (!isRecord(value) || (value.kind !== "mypiu" && value.kind !== "piugame") || typeof value.url !== "string") {
    return null;
  }
  try {
    const url = new URL(value.url);
    const expectedOrigins = value.kind === "mypiu"
      ? new Set(["https://mypiu.austin.kim"])
      : new Set(["https://www.piugame.com", "https://phoenix.piugame.com"]);
    if (
      url.protocol !== "https:"
      || url.username
      || url.password
      || !ALLOWED_RECOVERY_ORIGINS.has(url.origin)
      || !expectedOrigins.has(url.origin)
    ) {
      return null;
    }
    return { kind: value.kind, url: url.href };
  } catch {
    return null;
  }
}

function isNonnegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function isManifestVersion(value: string): boolean {
  const parts = value.split(".");
  return parts.length >= 1
    && parts.length <= 4
    && parts.every((part) => /^(?:0|[1-9]\d*)$/.test(part) && Number(part) <= 65_535);
}

function plural(count: number, word: string): string {
  return count === 1 ? word : `${word}s`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
