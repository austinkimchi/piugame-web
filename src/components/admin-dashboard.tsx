"use client";

import { ShieldCheck, ShieldMinus, Search } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import type { AdminUserSearchResult } from "@/lib/auth";

export function AdminDashboard() {
  const [query, setQuery] = useState("");
  const [users, setUsers] = useState<AdminUserSearchResult[]>([]);
  const [status, setStatus] = useState("");

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      void loadUsers(query);
    }, 180);
    return () => window.clearTimeout(timeout);
  }, [query]);

  async function loadUsers(nextQuery: string) {
    const response = await fetch(`/api/admin/users?q=${encodeURIComponent(nextQuery)}`, { cache: "no-store" });
    const body = (await response.json()) as { users?: AdminUserSearchResult[]; error?: string };
    if (!response.ok || !body.users) {
      setStatus(body.error ?? "Could not load users.");
      return;
    }
    setUsers(body.users);
    setStatus("");
  }

  async function setModerator(userId: string, enabled: boolean) {
    const notes = window.prompt(enabled ? "Moderator assignment notes" : "Moderator removal notes") ?? "";
    const response = await fetch("/api/admin/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, moderator: enabled, notes }),
    });
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    if (!response.ok) {
      setStatus(body?.error ?? "Could not update role.");
      return;
    }
    setStatus(enabled ? "Moderator assigned." : "Moderator removed.");
    await loadUsers(query);
  }

  return (
    <section className="mx-auto min-h-screen max-w-5xl px-5 py-10 text-[#171916] sm:px-8 lg:px-10">
      <div className="mb-8">
        <Link className="text-sm font-black text-[#56604e] hover:text-[#28c950]" href="/">
          Catalog
        </Link>
        <h1 className="mt-5 text-5xl font-black leading-none sm:text-6xl">Admin</h1>
        <p className="mt-3 max-w-2xl text-sm font-medium leading-6 text-[#56604e]">
          Search site usernames and assign moderator permission. Admin permission is controlled only by backend environment.
        </p>
      </div>

      <label className="mb-5 flex min-h-12 items-center gap-3 border border-[#cfd7c8] bg-white px-3">
        <Search aria-hidden="true" className="text-[#626c5c]" size={18} />
        <input
          className="w-full bg-transparent text-base font-bold outline-none placeholder:text-[#8b9483]"
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search username, email, or name"
          value={query}
        />
      </label>

      {status ? <p className="mb-4 text-sm font-bold text-[#66705f]">{status}</p> : null}

      <div className="grid gap-3">
        {users.map((user) => {
          const isModerator = user.roles.includes("moderator");
          const isAdmin = user.roles.includes("admin");
          return (
            <article key={user.id} className="grid gap-3 border border-[#d8dfd1] bg-white p-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-lg font-black">{user.username ?? "No username"}</h2>
                  {user.roles.map((role) => (
                    <span key={role} className="border border-[#d8dfd1] bg-[#f7f8f2] px-2 py-1 text-[11px] font-black uppercase text-[#596153]">
                      {role}
                    </span>
                  ))}
                </div>
                <p className="mt-1 truncate text-sm font-semibold text-[#66705f]">{user.name} / {user.email}</p>
                {user.mutedUntil ? <p className="mt-1 text-xs font-black uppercase text-[#9b2b1f]">Muted until {new Date(user.mutedUntil).toLocaleDateString()}</p> : null}
              </div>
              <button
                className="inline-flex min-h-11 items-center justify-center gap-2 border border-[#171916] bg-[#171916] px-4 text-sm font-black text-white hover:bg-[#28c950] disabled:border-[#aeb8a5] disabled:bg-[#aeb8a5]"
                disabled={isAdmin}
                type="button"
                onClick={() => void setModerator(user.id, !isModerator)}
              >
                {isModerator ? <ShieldMinus aria-hidden="true" size={17} /> : <ShieldCheck aria-hidden="true" size={17} />}
                {isModerator ? "Remove moderator" : "Make moderator"}
              </button>
            </article>
          );
        })}
      </div>
    </section>
  );
}
