"use client";

import { UserRound, X } from "lucide-react";
import { useState } from "react";

export function UsernamePrompt({ compact = false, variant = "inline" }: { compact?: boolean; variant?: "inline" | "modal" }) {
  const [username, setUsername] = useState("");
  const [status, setStatus] = useState("");
  const [saving, setSaving] = useState(false);
  const [open, setOpen] = useState(false);

  async function saveUsername() {
    setSaving(true);
    setStatus("");
    const response = await fetch("/api/account/username", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username }),
    });
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    setSaving(false);
    if (!response.ok) {
      setStatus(body?.error ?? "Could not save username.");
      return;
    }
    window.location.reload();
  }

  const prompt = (
    <div className={`border border-[#28c950] bg-[#eef7ed] ${compact ? "p-3" : "p-4"}`}>
      <div className="mb-3 flex items-center gap-2 text-sm font-black uppercase text-[#1f5f39]">
        <UserRound aria-hidden="true" size={17} />
        Choose site username
      </div>
      <form
        className="flex flex-wrap gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          void saveUsername();
        }}
      >
        <input
          className="min-h-10 min-w-0 flex-1 border border-[#b9d9be] bg-white px-3 text-sm font-bold text-[#171916] outline-none focus:border-[#28c950]"
          maxLength={20}
          onChange={(event) => setUsername(event.target.value)}
          placeholder="letters, numbers, hypen, underscore"
          value={username}
        />
        <button
          className="min-h-10 bg-[#171916] px-4 text-sm font-black text-white hover:bg-[#28c950] disabled:bg-[#aeb8a5]"
          disabled={saving}
          type="submit"
        >
          Save
        </button>
      </form>
      {status ? <p className="mt-2 text-xs font-bold text-[#9b2b1f]">{status}</p> : null}
    </div>
  );

  if (variant === "inline") {
    return prompt;
  }

  return (
    <>
      <button
        className="group inline-flex h-12 items-center gap-3 border border-[#cdd5c5] bg-white/78 px-3 text-sm font-black text-[#171916] shadow-[0_10px_28px_rgba(29,35,24,0.07)] backdrop-blur transition hover:border-[#28c950] hover:bg-white hover:text-[#1f5f39]"
        type="button"
        onClick={() => setOpen(true)}
      >
        <span className="grid h-8 w-8 place-items-center bg-[#171916] text-white transition group-hover:bg-[#28c950]">
          <UserRound aria-hidden="true" size={16} />
        </span>
        Choose username
      </button>
      {open ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#171916]/35 px-4 backdrop-blur-sm" role="presentation">
          <div className="w-full max-w-md border border-[#cdd5c5] bg-[#fbfcf7] p-4 shadow-[0_28px_90px_rgba(17,19,15,0.24)]">
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <h2 className="text-xl font-black text-[#11130f]">Choose site username</h2>
                <p className="mt-1 text-sm font-medium leading-6 text-[#56604e]">This is the name other MyPIU users will see in community areas.</p>
              </div>
              <button
                className="inline-flex h-10 w-10 shrink-0 items-center justify-center border border-[#cdd5c5] bg-white text-[#56604e] hover:border-[#171916] hover:text-[#171916]"
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close username popup"
              >
                <X aria-hidden="true" size={18} />
              </button>
            </div>
            {prompt}
          </div>
        </div>
      ) : null}
    </>
  );
}
