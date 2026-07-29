"use client";

import { Search, Volume2, VolumeX } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { SongCard } from "@/components/song-card";
import type { PublicSong } from "@/lib/types";

interface SearchResponse {
  songs: PublicSong[];
  nextCursor: string | null;
  error?: string;
}

interface SongExplorerProps {
  initialSongs: PublicSong[];
}

export function SongExplorer({ initialSongs }: SongExplorerProps) {
  const [previewEnabled, setPreviewEnabled] = useState(false);
  const [query, setQuery] = useState("");
  const [songs, setSongs] = useState(initialSongs);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const endpoint = useCallback((searchQuery: string, cursor?: string | null) => {
      const params = new URLSearchParams();
      params.set("q", searchQuery);
      if (cursor) {
        params.set("cursor", cursor);
      }
      return `/api/songs/search?${params.toString()}`;
    }, []);

  const canSearch = useMemo(() => query.trim().length >= 2, [query]);
  const trimmedQuery = query.trim();
  const displayedSongs = canSearch ? songs : initialSongs;
  const displayedNextCursor = canSearch ? nextCursor : null;
  const displayedStatus = trimmedQuery.length === 0
    ? ""
    : trimmedQuery.length === 1
      ? "Type at least 2 characters to search."
      : status;

  const runSearch = useCallback(async (searchQuery: string, cursor?: string | null) => {
    const trimmedQuery = searchQuery.trim();
    if (trimmedQuery.length < 2) {
      setStatus("Type at least 2 characters to search.");
      return;
    }

    setIsLoading(true);
    setStatus(cursor ? "Loading more songs..." : "Searching...");

    try {
      const response = await fetch(endpoint(trimmedQuery, cursor), { cache: "no-store" });
      const body = (await response.json()) as SearchResponse;
      if (!response.ok) {
        setStatus(body.error ?? "Search failed.");
        return;
      }

      setSongs((current) => (cursor ? [...current, ...body.songs] : body.songs));
      setNextCursor(body.nextCursor);
      setStatus(body.songs.length === 0 && !cursor ? "No songs matched that search." : "");
    } catch {
      setStatus("Search failed. Try again in a moment.");
    } finally {
      setIsLoading(false);
    }
  }, [endpoint]);

  useEffect(() => {
    const trimmedQuery = query.trim();

    if (trimmedQuery.length < 2) {
      return;
    }

    const timeout = window.setTimeout(() => {
      void runSearch(trimmedQuery);
    }, 320);

    return () => window.clearTimeout(timeout);
  }, [initialSongs, query, runSearch]);

  return (
    <section className="mx-auto max-w-7xl px-5 py-7 sm:px-8 lg:px-10">
      <div className="mb-6 grid gap-4 border-y border-[#d9ded2] py-4 lg:grid-cols-[minmax(260px,1fr)_auto] lg:items-center">
        <label className="flex min-h-11 items-center gap-3 border border-[#cfd7c8] bg-white px-3">
          <Search aria-hidden="true" size={18} className="shrink-0 text-[#626c5c]" />
          <input
            className="w-full bg-transparent text-base outline-none placeholder:text-[#8b9483]"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && canSearch) {
                void runSearch(query);
              }
            }}
            placeholder="Search title, artist, folder, series, or tag"
          />
        </label>

        <div className="flex justify-start lg:justify-end">
          <button
            aria-label={previewEnabled ? "Disable hover previews" : "Enable hover previews"}
            aria-pressed={previewEnabled}
            className="inline-flex size-11 items-center justify-center border border-[#cfd7c8] bg-white font-semibold text-[#343b30] transition hover:bg-[#eef1e8]"
            type="button"
            onClick={() => setPreviewEnabled((value) => !value)}
          >
            {previewEnabled ? <Volume2 aria-hidden="true" size={18} /> : <VolumeX aria-hidden="true" size={18} />}
          </button>
        </div>
      </div>

      {displayedStatus ? <p className="mb-4 text-sm font-medium text-[#697362]">{displayedStatus}</p> : null}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6">
        {displayedSongs.map((song) => (
          <SongCard key={`${song.version}-${song.slug}`} previewEnabled={previewEnabled} song={song} />
        ))}
      </div>

      {displayedNextCursor ? (
        <div className="mt-8 flex justify-center">
          <button
            className="border border-[#171916] bg-[#171916] px-6 py-3 font-bold text-white transition hover:bg-[#343b30] disabled:opacity-60"
            disabled={isLoading}
            type="button"
            onClick={() => void runSearch(query, displayedNextCursor)}
          >
            Load more
          </button>
        </div>
      ) : null}
    </section>
  );
}
