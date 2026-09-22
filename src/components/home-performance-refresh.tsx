"use client";

import { useEffect } from "react";

import { emitPerformanceRefreshState } from "@/lib/performance-refresh-events";

let startedForPageLoad = false;

export function HomePerformanceRefresh({ enabled }: { enabled: boolean }) {
  useEffect(() => {
    if (!enabled || startedForPageLoad) {
      return;
    }

    startedForPageLoad = true;
    async function refreshPerformance() {
      emitPerformanceRefreshState("syncing");
      try {
        await fetch("/api/performance/sync?response=json&background=true", {
          method: "POST",
          headers: { Accept: "application/json" },
          cache: "no-store",
        });
      } finally {
        emitPerformanceRefreshState("idle");
      }
    }

    void refreshPerformance().catch(() => undefined);
  }, [enabled]);

  return null;
}
