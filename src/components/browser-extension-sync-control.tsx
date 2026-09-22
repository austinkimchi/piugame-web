"use client";

import { ExternalLink, Laptop, LoaderCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import {
  browserSyncSuccessMessage,
  parseExtensionReady,
  parseExtensionSyncResult,
  type BrowserExtensionSyncResult,
} from "@/lib/browser-extension-sync";
import { emitPerformanceRefreshState } from "@/lib/performance-refresh-events";

const EXTENSION_CHECK_DELAY_MS = 800;
const SYNC_TIMEOUT_MS = 60_000;

type ExtensionState =
  | { kind: "checking" }
  | { kind: "missing" }
  | { kind: "ready"; version: string };

export function BrowserExtensionSyncControl() {
  const router = useRouter();
  const mountedRef = useRef(true);
  const [extension, setExtension] = useState<ExtensionState>({ kind: "checking" });
  const [syncing, setSyncing] = useState(false);
  const [result, setResult] = useState<BrowserExtensionSyncResult | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    const onReady = (event: Event) => {
      const ready = parseExtensionReady((event as CustomEvent<unknown>).detail);
      if (ready) {
        setExtension({ kind: "ready", version: ready.version });
      }
    };
    const timer = window.setTimeout(() => {
      setExtension((current) => current.kind === "checking" ? { kind: "missing" } : current);
    }, EXTENSION_CHECK_DELAY_MS);

    window.addEventListener("mypiu:extension-ready", onReady);
    window.dispatchEvent(new Event("mypiu:request-extension-status"));
    return () => {
      mountedRef.current = false;
      window.clearTimeout(timer);
      window.removeEventListener("mypiu:extension-ready", onReady);
    };
  }, []);

  async function syncFromBrowser() {
    if (extension.kind !== "ready" || syncing) return;
    setSyncing(true);
    setResult(null);
    emitPerformanceRefreshState("syncing");
    try {
      const nextResult = await requestExtensionSync();
      if (!mountedRef.current) return;
      setResult(nextResult);
      if (nextResult.ok) {
        router.refresh();
      }
    } finally {
      if (mountedRef.current) {
        setSyncing(false);
      }
      emitPerformanceRefreshState("idle");
    }
  }

  return (
    <div>
      <button
        className="inline-flex h-11 w-full items-center justify-center gap-2 bg-[#28c950] px-4 text-sm font-black text-[#071109] transition hover:bg-[#35d867] disabled:cursor-not-allowed disabled:bg-[#d9ded2] disabled:text-[#66705e]"
        disabled={extension.kind !== "ready" || syncing}
        onClick={() => void syncFromBrowser()}
        type="button"
      >
        {syncing ? <LoaderCircle aria-hidden="true" className="animate-spin" size={16} /> : <Laptop aria-hidden="true" size={16} />}
        {syncing ? "Syncing on this device" : "Sync from this browser"}
      </button>
      <p aria-live="polite" className="mt-2 text-xs font-bold leading-5 text-[#66705e]">
        {statusText(extension, syncing, result)}
      </p>
      {result && !result.ok && result.recovery ? (
        <a
          className="mt-2 inline-flex items-center gap-1 text-xs font-black text-[#171916] underline decoration-[#aeb7a6] underline-offset-4"
          href={result.recovery.url}
          rel="noreferrer"
          target="_blank"
        >
          {result.recovery.kind === "piugame" ? "Sign in to PIUGAME" : "Open MyPIU"}
          <ExternalLink aria-hidden="true" size={13} />
        </a>
      ) : null}
    </div>
  );
}

function requestExtensionSync(): Promise<BrowserExtensionSyncResult> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: BrowserExtensionSyncResult) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      window.removeEventListener("mypiu:extension-sync-result", onResult);
      resolve(result);
    };
    const onResult = (event: Event) => {
      const result = parseExtensionSyncResult((event as CustomEvent<unknown>).detail);
      if (result) finish(result);
    };
    const timer = window.setTimeout(() => {
      finish({ ok: false, error: "Browser sync timed out. Retry after checking both sessions.", recovery: null });
    }, SYNC_TIMEOUT_MS);

    window.addEventListener("mypiu:extension-sync-result", onResult);
    window.dispatchEvent(new Event("mypiu:request-extension-sync"));
  });
}

function statusText(extension: ExtensionState, syncing: boolean, result: BrowserExtensionSyncResult | null): string {
  if (syncing) return "PIUGAME is being read by this browser.";
  if (result?.ok) return browserSyncSuccessMessage(result);
  if (result && !result.ok) return result.error;
  if (extension.kind === "checking") return "Checking for MyPIU Sync...";
  if (extension.kind === "missing") return "MyPIU Sync extension not detected.";
  return `MyPIU Sync ${extension.version} is ready.`;
}
