"use client";

import { Music, Pencil, Plus, Save, Trash2, Upload, X } from "lucide-react";
import { type ChangeEvent, type DragEvent, useMemo, useState } from "react";

import { useAdminViewMode } from "@/lib/admin-view-mode";
import type { CatalogEditorPayload, PiuSeriesId, PublicSong } from "@/lib/types";

interface CatalogAdminEditorProps {
  song: PublicSong;
  userIsAdmin: boolean;
  label: string;
  catalogVersion?: PiuSeriesId;
  focus?: "song" | "charts";
  onSaved?: (song: PublicSong) => void;
}

type SaveStatus = "idle" | "saving" | "error";
const AUDIO_ACCEPT = "audio/mpeg,audio/mp3,audio/ogg,audio/wav,audio/x-wav,audio/mp4,audio/x-m4a,.mp3,.ogg,.wav,.m4a";

export function CatalogAdminEditor({ song, userIsAdmin, label, catalogVersion, focus = "song", onSaved }: CatalogAdminEditorProps) {
  const { viewingAsRegular } = useAdminViewMode();
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [message, setMessage] = useState("");
  const [draft, setDraft] = useState<CatalogEditorPayload>(() => payloadFromSong(song));
  const [historyJson, setHistoryJson] = useState(() => JSON.stringify(payloadFromSong(song).history, null, 2));
  const [chartHistoryJson, setChartHistoryJson] = useState(() => JSON.stringify(payloadFromSong(song).chartHistory, null, 2));
  const [chartLinksJson, setChartLinksJson] = useState(() => JSON.stringify(payloadFromSong(song).chartLinks, null, 2));
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [draggingAudio, setDraggingAudio] = useState(false);
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

  function selectAudioFile(file: File | null) {
    if (!file) {
      return;
    }

    if (!file.type.startsWith("audio/") && !/\.(mp3|ogg|wav|m4a)$/i.test(file.name)) {
      setStatus("error");
      setMessage("Choose an MP3, OGG, WAV, or M4A file.");
      return;
    }

    setAudioFile(file);
    setStatus("idle");
    setMessage("");
  }

  function handleAudioInput(event: ChangeEvent<HTMLInputElement>) {
    selectAudioFile(event.target.files?.[0] ?? null);
  }

  function handleDragOver(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    if (event.dataTransfer.types.includes("Files")) {
      setDraggingAudio(true);
    }
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDraggingAudio(false);
    selectAudioFile(Array.from(event.dataTransfer.files).find((file) => file.type.startsWith("audio/") || /\.(mp3|ogg|wav|m4a)$/i.test(file.name)) ?? null);
  }

  async function save() {
    setStatus("saving");
    setMessage("");
    let history: CatalogEditorPayload["history"];
    let chartHistory: CatalogEditorPayload["chartHistory"];
    let chartLinks: CatalogEditorPayload["chartLinks"];
    try {
      history = JSON.parse(historyJson) as CatalogEditorPayload["history"];
      chartHistory = JSON.parse(chartHistoryJson) as CatalogEditorPayload["chartHistory"];
      chartLinks = JSON.parse(chartLinksJson) as CatalogEditorPayload["chartLinks"];
    } catch {
      setStatus("error");
      setMessage("History and chart links must contain valid JSON.");
      return;
    }
    const tags = draft.tags.map((tag) => tag.trim()).filter(Boolean);
    const chartTokens = draft.chartTokens.map((token) => token.trim()).filter(Boolean);
    const nextDraft = { ...draft, tags, chartTokens, history, chartHistory, chartLinks };
    const requestBody = audioFile ? new FormData() : JSON.stringify(nextDraft);
    const headers: HeadersInit = audioFile ? {} : { "Content-Type": "application/json" };

    if (audioFile && requestBody instanceof FormData) {
      requestBody.set("title", draft.title);
      requestBody.set("artist", draft.artist);
      requestBody.set("folder", draft.folder);
      requestBody.set("folderPosition", draft.folderPosition === null ? "" : String(draft.folderPosition));
      requestBody.set("series", draft.series);
      requestBody.set("tags", JSON.stringify(tags));
      requestBody.set("chartTokens", JSON.stringify(chartTokens));
      requestBody.set("history", JSON.stringify(history));
      requestBody.set("chartHistory", JSON.stringify(chartHistory));
      requestBody.set("chartLinks", JSON.stringify(chartLinks));
      requestBody.set("audio", audioFile);
    }

    const query = catalogVersion ? `?${new URLSearchParams({ version: catalogVersion }).toString()}` : "";
    let response: Response;
    try {
      response = await fetch(`/api/songs/${encodeURIComponent(song.slug)}/catalog${query}`, {
        method: "PATCH",
        headers,
        body: requestBody,
      });
    } catch {
      setStatus("error");
      setMessage("Could not confirm the update. Your changes are still here; check your connection and try again.");
      return;
    }
    const responseBody = (await response.json().catch(() => null)) as { error?: string; song?: PublicSong } | null;
    if (!response.ok || !responseBody?.song) {
      setStatus("error");
      setMessage(responseBody?.error ?? "Could not update catalog.");
      return;
    }

    setStatus("idle");
    setDraft(payloadFromSong(responseBody.song));
    setHistoryJson(JSON.stringify(responseBody.song.history, null, 2));
    setChartHistoryJson(JSON.stringify(responseBody.song.chartHistory, null, 2));
    setChartLinksJson(JSON.stringify(responseBody.song.chartLinks, null, 2));
    setAudioFile(null);
    setMessage("");
    onSaved?.(responseBody.song);
    setOpen(false);
  }

  return (
    <>
      <button
        className="notebook-action inline-flex size-10 items-center justify-center border border-[#d6ddcf] bg-white text-[#596153] shadow-[0_10px_28px_rgba(18,24,16,0.1)] transition hover:border-[#28c950] hover:text-[#28c950]"
        type="button"
        onClick={() => setOpen(true)}
        aria-label={title}
        title={title}
      >
        <Pencil aria-hidden="true" size={18} />
      </button>
      {open ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#171916]/40 px-4 py-6 backdrop-blur-sm" role="presentation">
          <div
            className={`max-h-[92vh] w-full max-w-2xl overflow-auto border bg-[#fbfcf7] p-4 shadow-[0_28px_90px_rgba(17,19,15,0.24)] transition ${draggingAudio ? "border-[#28c950] ring-4 ring-[#28c950]/20" : "border-[#cdd5c5]"}`}
            onDragLeave={() => setDraggingAudio(false)}
            onDragOver={handleDragOver}
            onDrop={handleDrop}
          >
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
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="grid gap-1 text-xs font-black uppercase text-[#596153]">
                      Folder position
                      <input
                        className="min-h-11 border border-[#d8dfd1] bg-white px-3 text-sm font-bold text-[#171916] outline-none focus:border-[#28c950]"
                        type="number"
                        min="1"
                        step="1"
                        inputMode="numeric"
                        value={draft.folderPosition ?? ""}
                        onChange={(event) => updateDraft("folderPosition", event.target.value === "" ? null : Number(event.target.value))}
                        placeholder="1"
                      />
                    </label>
                    <label className="grid min-w-0 gap-1 text-xs font-black uppercase text-[#596153]">
                      Upload audio
                      <span className="flex min-h-11 min-w-0 cursor-pointer items-center gap-2 overflow-hidden border border-dashed border-[#cdd5c5] bg-white px-3 text-sm font-bold normal-case text-[#56604e] transition hover:border-[#28c950] hover:text-[#1f5f39]">
                        {audioFile ? <Music aria-hidden="true" className="shrink-0" size={16} /> : <Upload aria-hidden="true" className="shrink-0" size={16} />}
                        <span className="min-w-0 flex-1 truncate">{audioFile?.name ?? song.audioPath ?? previewFilename(song.previewUrl) ?? "Drop or choose preview audio"}</span>
                      </span>
                      <input className="sr-only" accept={AUDIO_ACCEPT} type="file" onChange={handleAudioInput} />
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
              <section className="grid gap-3 border-t border-[#d8dfd1] pt-4">
                <h3 className="text-sm font-black uppercase text-[#596153]">History and chart links</h3>
                <p className="text-sm font-medium text-[#56604e]">Edit song-wide history, chart-specific history, and linked chart identities as JSON. Linked chart tokens share community data across versions.</p>
                <JsonEditor label="Song history" value={historyJson} onChange={setHistoryJson} />
                <JsonEditor label="Chart history" value={chartHistoryJson} onChange={setChartHistoryJson} />
                <JsonEditor label="Chart links" value={chartLinksJson} onChange={setChartLinksJson} />
              </section>
            </div>

            {message ? <p className="mt-4 text-sm font-bold text-[#9b2b1f]" role="alert">{message}</p> : null}
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

function previewFilename(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value, "https://mypiu.austin.kim");
    const filename = (url.pathname === "/api/audio-file" ? url.searchParams.get("path") : url.pathname)?.split("/").pop();
    return filename ? decodeURIComponent(filename) : "Existing preview audio";
  } catch {
    return "Existing preview audio";
  }
}

function payloadFromSong(song: PublicSong): CatalogEditorPayload {
  return {
    title: song.title,
    artist: song.artist,
    folder: song.folder ?? "",
    folderPosition: song.folderPosition,
    series: song.series ?? "",
    tags: song.tags,
    chartTokens: song.chartSummary,
    history: song.history,
    chartHistory: song.chartHistory,
    chartLinks: song.chartLinks,
  };
}

function JsonEditor({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <label className="grid gap-1 text-xs font-black uppercase text-[#596153]">{label}<textarea className="min-h-32 border border-[#d8dfd1] bg-white p-3 font-mono text-xs font-medium normal-case text-[#171916] outline-none focus:border-[#28c950]" value={value} onChange={(event) => onChange(event.target.value)} /></label>;
}
