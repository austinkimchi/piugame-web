"use client";

import { Check, RefreshCw, UserRound, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

import type { PublicUser } from "@/lib/auth";
import type { PiuCatalogVersion } from "@/lib/types";
import { AccountIntegrationsPanel } from "@/components/account-integrations";
import { requestAccountPreferences } from "@/lib/account-preference-request";
import { manageDialogFocus } from "@/lib/dialog-focus";

const VERSION_OPTIONS: Array<{ value: PiuCatalogVersion; label: string }> = [
  { value: "phoenix", label: "Phoenix" },
  { value: "phoenix2", label: "PHOENIX 2" },
];

export function AccountPreferencesPopup({ user, appleReady, discordReady }: { user: PublicUser; appleReady: boolean; discordReady: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [performanceAutoRefresh, setPerformanceAutoRefresh] = useState(user.preferences.performanceAutoRefresh);
  const [piuGameVersion, setPiuGameVersion] = useState<PiuCatalogVersion>(user.preferences.piuGameVersion);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState("");
  const dialogRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (!open || !dialog) return;
    return manageDialogFocus(dialog, dialog.querySelector("[aria-label='Close account preferences popup']"));
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open]);

  async function savePerformanceAutoRefresh(nextEnabled: boolean) {
    const previous = performanceAutoRefresh;
    setPerformanceAutoRefresh(nextEnabled);
    await savePreferences({ performanceAutoRefresh: nextEnabled }, () => setPerformanceAutoRefresh(previous));
  }

  async function savePiuGameVersion(nextVersion: PiuCatalogVersion) {
    const previous = piuGameVersion;
    setPiuGameVersion(nextVersion);
    const saved = await savePreferences({ piuGameVersion: nextVersion }, () => setPiuGameVersion(previous));
    if (saved) {
      router.refresh();
    }
  }

  async function savePreferences(preferences: { performanceAutoRefresh?: boolean; piuGameVersion?: PiuCatalogVersion }, revert: () => void): Promise<boolean> {
    setSaving(true);
    setStatus("");
    try {
      const result = await requestAccountPreferences(preferences);
      if (!result.ok) {
        revert();
        setStatus(result.error);
        return false;
      }
      setStatus("Saved");
      return true;
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div className="flex min-w-0 items-center gap-2 border border-[#cdd5c5] bg-white/70 px-3 py-2 shadow-[0_10px_28px_rgba(29,35,24,0.07)] backdrop-blur">
        <button
          aria-label="Open account preferences"
          className="flex h-8 w-8 shrink-0 items-center justify-center bg-[#171916] text-white transition hover:bg-[#28c950] focus:outline-none focus:ring-2 focus:ring-[#28c950] focus:ring-offset-2"
          onClick={() => setOpen(true)}
          title="Account preferences"
          type="button"
        >
          {user.imageUrl ? <span aria-hidden="true" className="h-full w-full bg-cover bg-center" style={{ backgroundImage: `url(${user.imageUrl})` }} /> : <UserRound aria-hidden="true" size={17} />}
        </button>
        <span className="min-w-0 truncate text-sm font-black text-[#171916]">{user.piuProfile?.displayName ?? user.username}</span>
      </div>

      {open ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#171916]/35 px-4 backdrop-blur-sm"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setOpen(false);
            }
          }}
        >
          <div ref={dialogRef} tabIndex={-1} aria-labelledby="account-preferences-title" aria-modal="true" className="max-h-[calc(100vh-2rem)] w-full max-w-md overflow-y-auto border border-[#cdd5c5] bg-[#fbfcf7] p-4 shadow-[0_28px_90px_rgba(17,19,15,0.24)]" role="dialog">
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <h2 id="account-preferences-title" className="text-xl font-black text-[#11130f]">Account preferences</h2>
                <p className="mt-1 text-sm font-medium leading-6 text-[#56604e]">{user.email}</p>
              </div>
              <button
                aria-label="Close account preferences popup"
                className="inline-flex h-10 w-10 shrink-0 items-center justify-center border border-[#cdd5c5] bg-white text-[#56604e] hover:border-[#171916] hover:text-[#171916]"
                onClick={() => setOpen(false)}
                type="button"
              >
                <X aria-hidden="true" size={18} />
              </button>
            </div>

            <div className="mb-3 border border-[#d8dfd0] bg-white p-3">
              <div className="flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <p className="flex items-center gap-2 text-sm font-black text-[#171916]">
                    <RefreshCw aria-hidden="true" size={15} />
                    Auto refresh
                  </p>
                  <p className="mt-1 text-xs font-bold leading-5 text-[#66705f]">Allows backend refresh when this site is not open.</p>
                </div>
                <button
                  aria-pressed={performanceAutoRefresh}
                  className={`relative h-8 w-14 shrink-0 border transition ${
                    performanceAutoRefresh ? "border-[#28c950] bg-[#28c950]" : "border-[#cdd5c5] bg-[#eef1e8]"
                  }`}
                  disabled={saving}
                  onClick={() => void savePerformanceAutoRefresh(!performanceAutoRefresh)}
                  title="Toggle backend auto refresh"
                  type="button"
                >
                  <span className={`absolute top-1 h-6 w-6 bg-white shadow transition ${performanceAutoRefresh ? "left-7" : "left-1"}`} />
                </button>
              </div>
            </div>

            <div className="border border-[#d8dfd0] bg-white p-3">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-black text-[#171916]">PIUGAME version</p>
                </div>
                {saving ? <span className="text-xs font-black uppercase text-[#66705f]">Saving</span> : null}
              </div>
              <div className="grid grid-cols-2 gap-2">
                {VERSION_OPTIONS.map((option) => {
                  const selected = piuGameVersion === option.value;
                  return (
                    <button
                      aria-pressed={selected}
                      className={`min-h-11 border px-3 py-2 text-center transition ${
                        selected ? "border-[#28c950] bg-[#ecfff0] text-[#071109]" : "border-[#d8dfd0] bg-[#fbfcf7] text-[#56604e] hover:border-[#171916] hover:text-[#171916]"
                      }`}
                      disabled={saving}
                      key={option.value}
                      onClick={() => void savePiuGameVersion(option.value)}
                      type="button"
                    >
                      <span className="flex items-center justify-center gap-2">
                        <span className="text-sm font-black">{option.label}</span>
                        {selected ? <Check aria-hidden="true" size={16} /> : null}
                      </span>
                    </button>
                  );
                })}
              </div>
              {status ? <p role={status === "Saved" ? "status" : "alert"} className={`mt-2 text-xs font-bold ${status === "Saved" ? "text-[#1b8f40]" : "text-[#9b2b1f]"}`}>{status}</p> : null}
            </div>
            <div className="mt-3">
              <AccountIntegrationsPanel appleReady={appleReady} discordReady={discordReady} user={user} />
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
