"use client";

import { Pencil, Plus, Save, Trash2, X } from "lucide-react";
import { useMemo, useState } from "react";

import { useAdminViewMode } from "@/lib/admin-view-mode";
import type { CatalogEditorPayload, PublicSong } from "@/lib/types";

interface CatalogAdminEditorProps {
  song: PublicSong;
  userIsAdmin: boolean;
  label: string;
  focus?: "song" | "charts";
}

type SaveStatus = "idle" | "saving" | "error";

export function CatalogAdminEditor({ song, userIsAdmin, label, focus = "song" }: CatalogAdminEditorProps) {
  const { viewingAsRegular } = useAdminViewMode();
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [message, setMessage] = useState("");
  const [draft, setDraft] = useState<CatalogEditorPayload>(() => payloadFromSong(song));
  const canEdit = userIsAdmin && !viewingAsRegular;
  const title = useMemo(() => `Edit ${label}`, [label]);

  if (!canEdit) {
    return null;
  }

  function updateDraft<K extends keyof CatalogEditorPayload>(key: K, value: CatalogEditorPayload[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  function updateChartToken(index: number, value: string) {
    setDraft((current) => ({
      ...current,
      chartTokens: current.chartTokens.map((token, tokenIndex) => (tokenIndex === index ? value : token)),
    }));
  }

  function removeChartToken(index: number) {
    setDraft((current) => ({
      ...current,
      chartTokens: current.chartTokens.filter((_, tokenIndex) => tokenIndex !== index),
    }));
  }

  function addChartToken() {
    setDraft((current) => ({ ...current, chartTokens: [...current.chartTokens, ""] }));
  }

  async function save() {
    setStatus("saving");
    setMessage("");
    const response = await fetch(`/api/songs/${encodeURIComponent(song.slug)}/catalog`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...draft,
        tags: draft.tags.map((tag) => tag.trim()).filter(Boolean),
        chartTokens: draft.chartTokens.map((token) => token.trim()).filter(Boolean),
      }),
    });
    const body = (await response.json().catch(() => null)) as { error?: string; song?: PublicSong } | null;
    if (!response.ok || !body?.song) {
      setStatus("error");
      setMessage(body?.error ?? "Could not update catalog.");
      return;
    }

    setStatus("idle");
    window.location.href = `/songs/${body.song.slug}`;
  }

  return (
    <>
      <button
        className="inline-flex h-8 w-8 items-center justify-center border border-[#cdd5c5] bg-white text-[#596153] shadow-[0_8px_18px_rgba(29,35,24,0.07)] transition hover:border-[#28c950] hover:text-[#28c950]"
        type="button"
        onClick={() => setOpen(true)}
        aria-label={title}
        title={title}
      >
        <Pencil aria-hidden="true" size={15} />
      </button>
      {open ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#171916]/40 px-4 py-6 backdrop-blur-sm" role="presentation">
          <div className="max-h-[92vh] w-full max-w-2xl overflow-auto border border-[#cdd5c5] bg-[#fbfcf7] p-4 shadow-[0_28px_90px_rgba(17,19,15,0.24)]">
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <h2 className="text-xl font-black text-[#11130f]">{title}</h2>
                <p className="mt-1 text-sm font-medium leading-6 text-[#56604e]">Updates write directly to the catalog database.</p>
              </div>
              <button
                className="inline-flex h-10 w-10 shrink-0 items-center justify-center border border-[#cdd5c5] bg-white text-[#56604e] hover:border-[#171916] hover:text-[#171916]"
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close catalog editor"
              >
                <X aria-hidden="true" size={18} />
              </button>
            </div>

            <div className="grid gap-4">
              {focus !== "charts" ? (
                <section className="grid gap-3">
                  <label className="grid gap-1 text-xs font-black uppercase text-[#596153]">
                    Title
                    <input className="min-h-11 border border-[#d8dfd1] bg-white px-3 text-base font-bold text-[#171916] outline-none focus:border-[#28c950]" value={draft.title} onChange={(event) => updateDraft("title", event.target.value)} />
                  </label>
                  <label className="grid gap-1 text-xs font-black uppercase text-[#596153]">
                    Artist
                    <input className="min-h-11 border border-[#d8dfd1] bg-white px-3 text-base font-bold text-[#171916] outline-none focus:border-[#28c950]" value={draft.artist} onChange={(event) => updateDraft("artist", event.target.value)} />
                  </label>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="grid gap-1 text-xs font-black uppercase text-[#596153]">
                      Series
                      <input className="min-h-11 border border-[#d8dfd1] bg-white px-3 text-sm font-bold text-[#171916] outline-none focus:border-[#28c950]" value={draft.series} onChange={(event) => updateDraft("series", event.target.value)} />
                    </label>
                    <label className="grid gap-1 text-xs font-black uppercase text-[#596153]">
                      Folder
                      <input className="min-h-11 border border-[#d8dfd1] bg-white px-3 text-sm font-bold text-[#171916] outline-none focus:border-[#28c950]" value={draft.folder} onChange={(event) => updateDraft("folder", event.target.value)} />
                    </label>
                  </div>
                  <label className="grid gap-1 text-xs font-black uppercase text-[#596153]">
                    Tags
                    <input
                      className="min-h-11 border border-[#d8dfd1] bg-white px-3 text-sm font-bold text-[#171916] outline-none focus:border-[#28c950]"
                      value={draft.tags.join(", ")}
                      onChange={(event) => updateDraft("tags", event.target.value.split(",").map((tag) => tag.trim()))}
                      placeholder="tag one, tag two"
                    />
                  </label>
                </section>
              ) : null}

              <section className="grid gap-3">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-sm font-black uppercase text-[#596153]">Chart Tokens</h3>
                  <button className="inline-flex items-center gap-2 border border-[#cdd5c5] bg-white px-3 py-2 text-xs font-black uppercase text-[#56604e] hover:border-[#28c950] hover:text-[#1f5f39]" type="button" onClick={addChartToken}>
                    <Plus aria-hidden="true" size={14} />
                    Add chart
                  </button>
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  {draft.chartTokens.map((token, index) => (
                    <div key={`${index}:${token}`} className="flex gap-2">
                      <input
                        className="min-h-10 min-w-0 flex-1 border border-[#d8dfd1] bg-white px-3 text-sm font-black uppercase text-[#171916] outline-none focus:border-[#28c950]"
                        value={token}
                        onChange={(event) => updateChartToken(index, event.target.value)}
                        placeholder="S19"
                      />
                      <button className="inline-flex h-10 w-10 shrink-0 items-center justify-center border border-[#d8dfd1] bg-white text-[#66705f] hover:border-[#9b2b1f] hover:text-[#9b2b1f]" type="button" onClick={() => removeChartToken(index)} aria-label={`Remove ${token || "chart"}`}>
                        <Trash2 aria-hidden="true" size={15} />
                      </button>
                    </div>
                  ))}
                </div>
              </section>
            </div>

            {message ? <p className="mt-4 text-sm font-bold text-[#9b2b1f]">{message}</p> : null}
            <div className="mt-5 flex justify-end gap-2">
              <button className="border border-[#cdd5c5] bg-white px-4 py-2 text-sm font-black text-[#56604e] hover:border-[#171916] hover:text-[#171916]" type="button" onClick={() => setOpen(false)}>
                Cancel
              </button>
              <button className="inline-flex items-center gap-2 bg-[#171916] px-4 py-2 text-sm font-black text-white hover:bg-[#28c950] disabled:bg-[#aeb8a5]" type="button" disabled={status === "saving"} onClick={() => void save()}>
                <Save aria-hidden="true" size={16} />
                {status === "saving" ? "Saving" : "Save catalog"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

function payloadFromSong(song: PublicSong): CatalogEditorPayload {
  return {
    title: song.title,
    artist: song.artist,
    folder: song.folder ?? "",
    series: song.series ?? "",
    tags: song.tags,
    chartTokens: song.chartSummary,
  };
}
