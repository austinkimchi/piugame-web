"use client";

import { Gamepad2, Link2, X } from "lucide-react";
import { useState } from "react";

import type { PublicUser } from "@/lib/auth";

export function AccountIntegrations({ user, discordReady }: { user: PublicUser; discordReady: boolean }) {
  const [open, setOpen] = useState(false);
  const [piuUsername, setPiuUsername] = useState(user.piuProfile?.piuUsername ?? "");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState("");
  const [saving, setSaving] = useState(false);

  async function linkPiu() {
    setSaving(true);
    setStatus("");
    const response = await fetch("/api/account/piu-link", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ piuUsername, password }),
    });
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    setSaving(false);
    if (!response.ok) {
      setStatus(body?.error ?? "Could not link PIU account.");
      return;
    }
    window.location.reload();
  }

  return (
    <>
      <button
        className="inline-flex h-12 w-12 items-center justify-center border border-[#cdd5c5] bg-white/70 text-[#56604e] shadow-[0_10px_28px_rgba(29,35,24,0.07)] backdrop-blur transition hover:border-[#28c950] hover:bg-white hover:text-[#28c950]"
        type="button"
        onClick={() => setOpen(true)}
        title="Link accounts"
      >
        <Link2 aria-hidden="true" size={17} />
      </button>
      {open ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#171916]/35 px-4 backdrop-blur-sm" role="presentation">
          <div className="w-full max-w-md border border-[#cdd5c5] bg-[#fbfcf7] p-4 shadow-[0_28px_90px_rgba(17,19,15,0.24)]">
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <h2 className="text-xl font-black text-[#11130f]">Linked accounts</h2>
                <p className="mt-1 text-sm font-medium leading-6 text-[#56604e]">Connect Discord and your Pump It Up profile.</p>
              </div>
              <button
                className="inline-flex h-10 w-10 shrink-0 items-center justify-center border border-[#cdd5c5] bg-white text-[#56604e] hover:border-[#171916] hover:text-[#171916]"
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close linked accounts popup"
              >
                <X aria-hidden="true" size={18} />
              </button>
            </div>

            <div className="space-y-3">
              <div className="border border-[#d8dfd0] bg-white p-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-black text-[#171916]">Discord</p>
                    <p className="mt-1 truncate text-xs font-bold text-[#66705f]">{user.discord ? user.discord.username : "Not linked"}</p>
                  </div>
                  <a
                    className={`shrink-0 px-3 py-2 text-xs font-black ${discordReady ? "bg-[#5865f2] text-white hover:bg-[#4651c9]" : "bg-[#d6ddcf] text-[#66705f]"}`}
                    href="/api/auth/discord/login?next=/"
                    aria-disabled={!discordReady}
                  >
                    {user.discord ? "Reconnect" : "Link"}
                  </a>
                </div>
              </div>

              <div className="border border-[#d8dfd0] bg-white p-3">
                <div className="mb-3 flex items-center gap-2 text-sm font-black text-[#171916]">
                  <Gamepad2 aria-hidden="true" size={17} />
                  Pump It Up
                </div>
                {user.piuProfile ? (
                  <div className="mb-3 flex min-w-0 items-center gap-3">
                    {user.piuProfile.avatarUrl ? <span aria-hidden="true" className="h-10 w-10 shrink-0 bg-cover bg-center" style={{ backgroundImage: `url(${user.piuProfile.avatarUrl})` }} /> : null}
                    <div className="min-w-0">
                      <p className="truncate text-sm font-black text-[#171916]">{user.piuProfile.displayName}</p>
                      <p className="truncate text-xs font-bold text-[#66705f]">{user.piuProfile.piuUsername}</p>
                    </div>
                  </div>
                ) : null}
                <form
                  className="grid gap-2"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void linkPiu();
                  }}
                >
                  <input
                    className="min-h-10 border border-[#cdd5c5] bg-[#fbfcf7] px-3 text-sm font-bold text-[#171916] outline-none focus:border-[#28c950]"
                    onChange={(event) => setPiuUsername(event.target.value)}
                    placeholder="PIU username"
                    value={piuUsername}
                  />
                  <input
                    className="min-h-10 border border-[#cdd5c5] bg-[#fbfcf7] px-3 text-sm font-bold text-[#171916] outline-none focus:border-[#28c950]"
                    onChange={(event) => setPassword(event.target.value)}
                    placeholder="PIU password"
                    type="password"
                    value={password}
                  />
                  <button className="min-h-10 bg-[#171916] px-4 text-sm font-black text-white hover:bg-[#28c950] disabled:bg-[#aeb8a5]" disabled={saving} type="submit">
                    {user.piuProfile ? "Refresh link" : "Link PIU"}
                  </button>
                </form>
                {status ? <p className="mt-2 text-xs font-bold text-[#9b2b1f]">{status}</p> : null}
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
