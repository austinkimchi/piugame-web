"use client";

import { ExternalLink, Laptop, LoaderCircle, RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";

import {
  browserSyncSuccessMessage,
  parseExtensionReady,
  parseExtensionSyncResult,
  type BrowserExtensionSyncResult,
} from "@/lib/browser-extension-sync";
import {
  emitPerformanceRefreshState,
  getPerformanceRefreshState,
  subscribePerformanceRefreshState,
} from "@/lib/performance-refresh-events";

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
  const [serverSyncing, setServerSyncing] = useState(false);
  const [result, setResult] = useState<BrowserExtensionSyncResult | null>(null);
  const [serverMessage, setServerMessage] = useState<string | null>(null);
  const sharedRefreshState = useSyncExternalStore(
    subscribePerformanceRefreshState,
    getPerformanceRefreshState,
    getPerformanceRefreshState,
  );
  const busy = syncing || serverSyncing || sharedRefreshState === "syncing";

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
    if (extension.kind !== "ready" || busy) return;
    setSyncing(true);
    setResult(null);
    setServerMessage(null);
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

  async function refreshOnServer() {
    if (busy) return;
    setServerSyncing(true);
    setResult(null);
    setServerMessage(null);
    emitPerformanceRefreshState("syncing");
    try {
      const response = await fetch("/api/performance/sync?response=json", {
        method: "POST",
        headers: { Accept: "application/json" },
        cache: "no-store",
      });
      const body = (await response.json().catch(() => null)) as { error?: unknown; throttled?: unknown } | null;
      if (!mountedRef.current) return;
      if (!response.ok) {
        setServerMessage(typeof body?.error === "string" && body.error.trim() ? body.error.trim() : "Server refresh failed.");
        return;
      }
      setServerMessage(body?.throttled === true ? "Server refresh is already up to date." : "Server refresh complete.");
      router.refresh();
    } catch {
      if (mountedRef.current) {
        setServerMessage("Server refresh failed.");
      }
    } finally {
      if (mountedRef.current) {
        setServerSyncing(false);
      }
      emitPerformanceRefreshState("idle");
    }
  }

  return (
    <div>
      <button
        className="inline-flex h-11 w-full items-center justify-center gap-2 bg-[#28c950] px-4 text-sm font-black text-[#071109] transition hover:bg-[#35d867] disabled:cursor-not-allowed disabled:bg-[#d9ded2] disabled:text-[#66705e]"
        disabled={extension.kind !== "ready" || busy}
        onClick={() => void syncFromBrowser()}
        type="button"
      >
        {busy ? <LoaderCircle aria-hidden="true" className="animate-spin" size={16} /> : <Laptop aria-hidden="true" size={16} />}
        {syncing ? "Syncing on this device" : sharedRefreshState === "syncing" ? "Refresh in progress" : "Sync from this browser"}
      </button>
      <p aria-live="polite" className="mt-2 text-xs font-bold leading-5 text-[#66705e]">
        {statusText(extension, syncing, serverSyncing, sharedRefreshState === "syncing", result, serverMessage)}
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
      <button
        className="mt-3 inline-flex h-10 w-full items-center justify-center gap-2 border border-[#cdd5c5] bg-white px-4 text-xs font-black text-[#56604e] transition hover:border-[#171916] hover:text-[#171916] disabled:cursor-not-allowed disabled:bg-[#f0f2ec] disabled:text-[#8a9384]"
        disabled={busy}
        onClick={() => void refreshOnServer()}
        type="button"
      >
        {serverSyncing ? <LoaderCircle aria-hidden="true" className="animate-spin" size={15} /> : <RefreshCw aria-hidden="true" size={15} />}
        {serverSyncing ? "Refreshing on server" : "Refresh on server"}
      </button>
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

function statusText(
  extension: ExtensionState,
  syncing: boolean,
  serverSyncing: boolean,
  sharedRefreshActive: boolean,
  result: BrowserExtensionSyncResult | null,
  serverMessage: string | null,
): string {
  if (syncing) return "PIUGAME is being read by this browser.";
  if (serverSyncing) return "MyPIU is refreshing through the server fallback.";
  if (sharedRefreshActive) return "The current performance refresh is finishing.";
  if (result?.ok) return browserSyncSuccessMessage(result);
  if (result && !result.ok) return result.error;
  if (serverMessage) return serverMessage;
  if (extension.kind === "checking") return "Checking for MyPIU Sync...";
  if (extension.kind === "missing") return "MyPIU Sync extension not detected.";
  return `MyPIU Sync ${extension.version} is ready.`;
}
