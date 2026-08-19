"use client";

import { useEffect } from "react";

let startedForPageLoad = false;

export function HomePerformanceRefresh({ enabled }: { enabled: boolean }) {
  useEffect(() => {
    if (!enabled || startedForPageLoad) {
      return;
    }

    startedForPageLoad = true;
    void fetch("/api/performance/sync?response=json&background=true", {
      method: "POST",
      headers: { Accept: "application/json" },
      cache: "no-store",
    }).catch(() => undefined);
  }, [enabled]);

  return null;
}
