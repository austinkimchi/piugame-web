"use client";

import { Gamepad2, Pencil } from "lucide-react";
import { useState } from "react";

import type { PublicUser } from "@/lib/auth";

export function AccountIntegrationsPanel({ user, appleReady, discordReady }: { user: PublicUser; appleReady: boolean; discordReady: boolean }) {
  const [piuUsername, setPiuUsername] = useState(user.piuProfile?.piuUsername ?? "");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState("");
  const [saving, setSaving] = useState(false);
  const [editingPiu, setEditingPiu] = useState(!user.piuProfile);

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

  async function disconnectDiscord() {
    setSaving(true);
    setStatus("");
    const response = await fetch("/api/account/discord-link", { method: "DELETE" });
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    setSaving(false);
    if (!response.ok) {
      setStatus(body?.error ?? "Could not disconnect Discord.");
      return;
    }
    window.location.reload();
  }

  return (
    <section className="border border-[#d8dfd0] bg-white p-3">
      <div className="mb-3">
        <p className="text-sm font-black text-[#171916]">Linked accounts</p>
        <p className="mt-1 text-xs font-bold text-[#66705f]">Connect Apple, Discord, and your Pump It Up profile.</p>
      </div>
      <div className="space-y-3">
        <div className="border border-[#d8dfd0] bg-[#fbfcf7] p-3">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-black text-[#171916]">Apple</p>
              <p className="mt-1 truncate text-xs font-bold text-[#66705f]">
                {user.authProviders.includes("apple") ? "Connected" : "Use the same account on iPhone and web"}
              </p>
            </div>
            {user.authProviders.includes("apple") ? (
              <span className="shrink-0 border border-[#b9d9bf] bg-[#effbf1] px-3 py-2 text-xs font-black text-[#247238]">Linked</span>
            ) : (
              <a className={`shrink-0 px-3 py-2 text-xs font-black ${appleReady ? "bg-black text-white hover:bg-[#242424]" : "bg-[#d6ddcf] text-[#66705f]"}`} href={appleReady ? "/api/auth/apple/login?next=/" : undefined} aria-disabled={!appleReady}>Link</a>
            )}
          </div>
        </div>

        <div className="border border-[#d8dfd0] bg-[#fbfcf7] p-3">
          <div className="mb-3 flex items-center justify-between gap-2 text-sm font-black text-[#171916]">
            <span className="flex items-center gap-2"><Gamepad2 aria-hidden="true" size={17} />Pump It Up</span>
            {user.piuProfile && !editingPiu ? (
              <button className="inline-flex min-h-8 items-center gap-1 border border-[#cdd5c5] bg-white px-2 text-xs font-black text-[#56604e] hover:border-[#171916] hover:text-[#171916]" onClick={() => setEditingPiu(true)} type="button">
                <Pencil aria-hidden="true" size={13} /> Edit
              </button>
            ) : null}
          </div>
          {user.piuProfile ? (
            <div className={editingPiu ? "mb-3 flex min-w-0 items-center gap-3" : "flex min-w-0 items-center gap-3"}>
              {user.piuProfile.avatarUrl ? <span aria-hidden="true" className="h-10 w-10 shrink-0 bg-cover bg-center" style={{ backgroundImage: `url(${user.piuProfile.avatarUrl})` }} /> : null}
              <div className="min-w-0">
                <p className="truncate text-sm font-black text-[#171916]">{user.piuProfile.displayName}</p>
                <p className="truncate text-xs font-bold text-[#66705f]">{user.piuProfile.piuUsername}</p>
              </div>
            </div>
          ) : null}
          {editingPiu ? (
            <form
              className="grid gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                void linkPiu();
              }}
            >
              <input className="min-h-10 border border-[#cdd5c5] bg-white px-3 text-sm font-bold text-[#171916] outline-none focus:border-[#28c950]" onChange={(event) => setPiuUsername(event.target.value)} placeholder="PIU username" value={piuUsername} />
              <input className="min-h-10 border border-[#cdd5c5] bg-white px-3 text-sm font-bold text-[#171916] outline-none focus:border-[#28c950]" onChange={(event) => setPassword(event.target.value)} placeholder="PIU password" type="password" value={password} />
              <div className="flex gap-2">
                <button className="min-h-10 flex-1 bg-[#171916] px-4 text-sm font-black text-white hover:bg-[#28c950] disabled:bg-[#aeb8a5]" disabled={saving} type="submit">{user.piuProfile ? "Update link" : "Link Pump It Up"}</button>
                {user.piuProfile ? <button className="min-h-10 border border-[#cdd5c5] bg-white px-3 text-sm font-black text-[#56604e] hover:border-[#171916]" onClick={() => { setEditingPiu(false); setPassword(""); }} type="button">Cancel</button> : null}
              </div>
            </form>
          ) : null}
        </div>

        <div className="border border-[#d8dfd0] bg-[#fbfcf7] p-3">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-black text-[#171916]">Discord</p>
              <p className="mt-1 truncate text-xs font-bold text-[#66705f]">{user.discord ? user.discord.username : "Not linked"}</p>
            </div>
            {user.discord ? (
              <button className="shrink-0 border border-[#efb8af] bg-[#fff2f0] px-3 py-2 text-xs font-black text-[#a6382b] hover:border-[#cf6b5e] hover:bg-[#ffe5e1] disabled:opacity-60" disabled={saving} onClick={() => void disconnectDiscord()} type="button">Disconnect</button>
            ) : (
              <a className={`shrink-0 px-3 py-2 text-xs font-black ${discordReady ? "bg-[#5865f2] text-white hover:bg-[#4651c9]" : "bg-[#d6ddcf] text-[#66705f]"}`} href={discordReady ? "/api/auth/discord/login?next=/" : undefined} aria-disabled={!discordReady}>Link</a>
            )}
          </div>
        </div>
      </div>
      {status ? <p className="mt-2 text-xs font-bold text-[#9b2b1f]">{status}</p> : null}
    </section>
  );
}
