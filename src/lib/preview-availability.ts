"use client";

import { useSyncExternalStore } from "react";

type MediaFailure = Pick<MediaError, "code"> | null;

/** Memory only: a reload or a new upload URL gets a fresh playback attempt. */
export function createPreviewAvailability(
  origin: () => string | null,
  fetcher: typeof fetch = (...args) => fetch(...args),
) {
  const missing = new Set<string>();
  const pending = new Map<string, Promise<boolean>>();
  const listeners = new Set<() => void>();

  function localUrl(value: string | null): string | null {
    const base = origin();
    if (!value || !base) return null;
    try {
      const url = new URL(value, base);
      if (!/^https?:$/.test(url.protocol) || url.origin !== new URL(base).origin || url.username || url.password) return null;
      url.hash = "";
      return url.href;
    } catch {
      return null;
    }
  }

  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    isUnavailable(value: string | null) {
      const url = localUrl(value);
      return url !== null && missing.has(url);
    },
    confirmMediaFailure(value: string | null, error: MediaFailure): Promise<boolean> {
      // Browsers report a missing source as NETWORK (2) or SRC_NOT_SUPPORTED (4).
      // A rejected play() alone can mean autoplay denial or intentional cancellation.
      if (!error || (error.code !== 2 && error.code !== 4)) return Promise.resolve(false);
      const url = localUrl(value);
      if (!url) return Promise.resolve(false);
      if (missing.has(url)) return Promise.resolve(true);
      const existing = pending.get(url);
      if (existing) return existing;

      const check = Promise.resolve().then(async () => {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);
        try {
          const response = await fetcher(url, {
            headers: { Range: "bytes=0-0" },
            credentials: "same-origin",
            cache: "no-store",
            redirect: "error",
            signal: controller.signal,
          });
          // Never consume a full clip if a server ignores Range.
          void response.body?.cancel().catch(() => undefined);
          if (response.status !== 404) return false;
          missing.add(url);
          for (const listener of listeners) listener();
          return true;
        } catch {
          // Offline, timeouts, redirects and other transient failures remain retryable.
          return false;
        } finally {
          clearTimeout(timeout);
        }
      }).finally(() => pending.delete(url));
      pending.set(url, check);
      return check;
    },
  };
}

const availability = createPreviewAvailability(() => typeof window === "undefined" ? null : window.location.origin);

export const isPreviewUnavailable = availability.isUnavailable;
export const confirmPreviewMediaFailure = availability.confirmMediaFailure;

export function usePreviewUnavailable(url: string | null): boolean {
  return useSyncExternalStore(availability.subscribe, () => availability.isUnavailable(url), () => false);
}
