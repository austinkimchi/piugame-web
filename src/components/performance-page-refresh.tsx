"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { runPerformanceRefresh } from "@/lib/performance-refresh-events";

let pageLoadSyncStarted = false;

export function PerformancePageRefresh({ token }: { token: string | null }) {
  const router = useRouter();

  useEffect(() => {
    if (!token || pageLoadSyncStarted) {
      return;
    }

    pageLoadSyncStarted = true;

    async function refreshPerformance() {
      await runPerformanceRefresh(async () => {
        const response = await fetch("/api/performance/sync?response=json", {
          method: "POST",
          headers: {
            Accept: "application/json",
            Authorization: `Bearer ${token}`,
          },
          cache: "no-store",
        });

        if (response.ok) {
          router.refresh();
        }
      }, { wait: true });
    }

    void refreshPerformance().catch(() => undefined);
  }, [router, token]);

  return null;
}
