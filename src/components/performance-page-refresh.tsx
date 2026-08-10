"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";

export function PerformancePageRefresh({ enabled }: { enabled: boolean }) {
  const router = useRouter();
  const started = useRef(false);

  useEffect(() => {
    if (!enabled || started.current) {
      return;
    }

    started.current = true;
    const controller = new AbortController();

    async function refreshPerformance() {
      const response = await fetch("/api/performance/sync?response=json", {
        method: "POST",
        headers: {
          Accept: "application/json",
        },
        cache: "no-store",
        signal: controller.signal,
      });

      if (response.ok) {
        router.refresh();
      }
    }

    void refreshPerformance().catch(() => undefined);

    return () => {
      controller.abort();
    };
  }, [enabled, router]);

  return null;
}
