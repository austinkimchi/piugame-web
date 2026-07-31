"use client";

import { ChevronDown, ExternalLink, Filter, Link2, ListSortAscending, ListSortDescending, Search, Star, Volume2, VolumeX, X } from "lucide-react";
import { AnimatePresence, MotionConfig, motion } from "motion/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { CatalogAdminEditor } from "@/components/catalog-admin-editor";
import { GuestFeatureShowcase } from "@/components/guest-feature-showcase";
import { SongCard } from "@/components/song-card";
import { SongDetailView } from "@/components/song-detail-view";
import type { SongCommunityState } from "@/lib/auth";
import type { CatalogFilterOptions, LevelFilterMode, PublicSong, SongSortOption, SortDirection } from "@/lib/types";

interface SearchResponse {
  songs: PublicSong[];
  nextCursor: string | null;
  total: number;
  filterOptions: CatalogFilterOptions;
  error?: string;
}

interface SongExplorerProps {
  initialSongs: PublicSong[];
  featureSong: PublicSong | null;
  filterOptions: CatalogFilterOptions;
  canFavorite: boolean;
  initialPreviewMuted: boolean;
  initialPreviewVolume: number;
  userIsAdmin: boolean;
}

type FilterKey = "folders" | "series" | "levels" | "charts";
type LoadingMode = "replace" | "append" | null;
const SORT_OPTIONS: Array<{ value: SongSortOption; label: string }> = [
  { value: "series", label: "Series" },
  { value: "title", label: "Title" },
  { value: "artist", label: "Artist" },
  { value: "folder", label: "Folder" },
];
const SEARCH_HASH = "#search";
const NOTEBOOK_RESIZE_HANDLE_SIZE = 40;
const NOTEBOOK_SIZE_STORAGE_KEY = "mypiu-song-notebook-size:v2";
const PREVIEW_FADE_IN_MS = 100;
const PREVIEW_FADE_OUT_MS = 700;
const EMPTY_COMMUNITY_STATE: SongCommunityState = {
  saved: false,
  note: "",
  userTags: [],
  communityTags: [],
  tagVotes: [],
  posts: [],
};

interface PreviewAudioGraph {
  context: AudioContext;
  destination: AudioNode;
}

interface PreviewVoice {
  id: number;
  url: string;
  audio: HTMLAudioElement;
  source: MediaElementAudioSourceNode | null;
  compressor: DynamicsCompressorNode | null;
  gain: GainNode | null;
  fadeFrame: number | null;
  volume: number;
}

export function SongExplorer({ initialSongs, featureSong, filterOptions, canFavorite, initialPreviewMuted, initialPreviewVolume, userIsAdmin }: SongExplorerProps) {
  const landingSectionRef = useRef<HTMLElement | null>(null);
  const searchSectionRef = useRef<HTMLElement | null>(null);
  const filterPanelRef = useRef<HTMLElement | null>(null);
  const selectedFiltersRef = useRef<Record<FilterKey, string[]>>({
    folders: [],
    series: [],
    levels: [],
    charts: [],
  });
  const levelModeRef = useRef<LevelFilterMode>("and");
  const sortByRef = useRef<SongSortOption>("series");
  const sortDirectionRef = useRef<SortDirection>("desc");
  const favoritesFirstRef = useRef(false);
  const previewVoiceIdRef = useRef(0);
  const previewVoicesRef = useRef<PreviewVoice[]>([]);
  const previewAudioGraphRef = useRef<PreviewAudioGraph | null>(null);
  const activePreviewUrlRef = useRef<string | null>(null);
  const didMountPreviewPreferencesRef = useRef(false);
  const lastSavedPreviewPreferencesRef = useRef<{ muted: boolean; volume: number } | null>(null);
  const [preferredPreviewMuted, setPreferredPreviewMuted] = useState(initialPreviewMuted);
  const [previewVolume, setPreviewVolume] = useState(() => clampPreviewVolume(initialPreviewVolume));
  const [activePreviewUrl, setActivePreviewUrl] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [selectedFilters, setSelectedFilters] = useState<Record<FilterKey, string[]>>({
    folders: [],
    series: [],
    levels: [],
    charts: [],
  });
  const [songs, setSongs] = useState<PublicSong[]>(initialSongs);
  const [favoriteSlugs, setFavoriteSlugs] = useState<Set<string>>(
    () => new Set(initialSongs.filter((song) => song.isFavorite).map((song) => song.slug)),
  );
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [totalResults, setTotalResults] = useState(initialSongs.length);
  const [status, setStatus] = useState("");
  const [loadingMode, setLoadingMode] = useState<LoadingMode>(null);
  const [resultBatch, setResultBatch] = useState(0);
  const [compatibleFilterOptions, setCompatibleFilterOptions] = useState(filterOptions);
  const [levelMode, setLevelMode] = useState<LevelFilterMode>("and");
  const [sortBy, setSortBy] = useState<SongSortOption>("series");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [favoritesFirst, setFavoritesFirst] = useState(false);
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
  const [openSong, setOpenSong] = useState<PublicSong | null>(null);
  const [openSongChartToken, setOpenSongChartToken] = useState<string | null>(null);
  const [openSongCommunity, setOpenSongCommunity] = useState<{ slug: string; state: SongCommunityState } | null>(null);
  const [copiedSongSlug, setCopiedSongSlug] = useState<string | null>(null);
  const activeFilterCount = useMemo(
    () => Object.values(selectedFilters).reduce((count, values) => count + values.length, 0),
    [selectedFilters],
  );
  const favoritedInitialSongs = useMemo(
    () => initialSongs.map((song) => ({ ...song, isFavorite: favoriteSlugs.has(song.slug) })),
    [favoriteSlugs, initialSongs],
  );
  const previewMuted = preferredPreviewMuted;
  const previewEnabled = !previewMuted;

  const savePreviewPreferences = useCallback(
    (muted: boolean, volume: number, keepalive = false) => {
      if (!canFavorite) {
        return;
      }

      lastSavedPreviewPreferencesRef.current = { muted, volume };
      void fetch("/api/account/preferences", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        keepalive,
        body: JSON.stringify({
          songPreviewMuted: muted,
          songPreviewVolume: volume,
        }),
      });
    },
    [canFavorite],
  );

  const saveSearchControlPreferences = useCallback(
    (preferences: Partial<{ sortBy: SongSortOption; sortDirection: SortDirection; favoritesFirst: boolean }>) => {
      if (!canFavorite) {
        return;
      }

      void fetch("/api/account/preferences", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(preferences.sortBy ? { songExplorerSortBy: preferences.sortBy } : {}),
          ...(preferences.sortDirection ? { songExplorerSortDirection: preferences.sortDirection } : {}),
          ...(typeof preferences.favoritesFirst === "boolean" ? { songExplorerFavoritesFirst: preferences.favoritesFirst } : {}),
        }),
      });
    },
    [canFavorite],
  );

  const endpoint = useCallback((searchQuery: string, cursor: string | null, filters: Record<FilterKey, string[]>, mode: LevelFilterMode, sort: SongSortOption, direction: SortDirection, preferFavorites: boolean) => {
    const params = new URLSearchParams();
    params.set("q", searchQuery.trim());
    params.set("sortBy", sort);
    params.set("sortDirection", direction);
    if (preferFavorites) {
      params.set("favoritesFirst", "true");
    }
    if (cursor) {
      params.set("cursor", cursor);
    }

    filters.folders.forEach((value) => params.append("folder", value));
    filters.series.forEach((value) => params.append("series", value));
    filters.levels.forEach((value) => params.append("level", value));
    filters.charts.forEach((value) => params.append("chart", value));
    if (mode === "and") {
      params.set("levelMode", mode);
    }

    return `/api/songs/search?${params.toString()}`;
  }, []);

  const runSearch = useCallback(
    async (
      searchQuery: string,
      cursor: string | null = null,
      filters = selectedFiltersRef.current,
      mode = levelModeRef.current,
      sort = sortByRef.current,
      direction = sortDirectionRef.current,
      preferFavorites = favoritesFirstRef.current,
    ) => {
      setLoadingMode(cursor ? "append" : "replace");
      setStatus("");

      try {
        const response = await fetch(endpoint(searchQuery, cursor, filters, mode, sort, direction, preferFavorites), { cache: "no-store" });
        const body = (await response.json()) as SearchResponse;
        if (!response.ok) {
          setStatus(body.error ?? "Search failed.");
          return;
        }

        setSongs((current) => (cursor ? [...current, ...body.songs] : body.songs));
        if (!cursor) {
          setResultBatch((current) => current + 1);
          setCompatibleFilterOptions(body.filterOptions);
        }
        setNextCursor(body.nextCursor);
        setTotalResults(body.total);
        setStatus(body.songs.length === 0 && !cursor ? "No songs matched those filters." : "");
      } catch {
        setStatus("Search failed. Try again in a moment.");
      } finally {
        setLoadingMode(null);
      }
    },
    [endpoint],
  );

  const updateSongFavorite = useCallback((songSlug: string, isFavorite: boolean) => {
    setFavoriteSlugs((current) => {
      const next = new Set(current);
      if (isFavorite) {
        next.add(songSlug);
      } else {
        next.delete(songSlug);
      }
      return next;
    });
    setSongs((current) => current.map((song) => (song.slug === songSlug ? { ...song, isFavorite } : song)));
    setOpenSong((current) => (current?.slug === songSlug ? { ...current, isFavorite } : current));
  }, []);

  const toggleFavorite = useCallback(
    async (song: PublicSong) => {
      if (!canFavorite) {
        window.location.href = `/api/auth/google/login?next=/songs/${song.slug}`;
        return;
      }

      const nextFavorite = !favoriteSlugs.has(song.slug);
      updateSongFavorite(song.slug, nextFavorite);
      try {
        const response = await fetch(`/api/songs/${encodeURIComponent(song.slug)}/community`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "save", saved: nextFavorite }),
        });
        const body = (await response.json()) as { state?: { saved: boolean } };
        if (!response.ok || !body.state) {
          updateSongFavorite(song.slug, !nextFavorite);
          return;
        }
        updateSongFavorite(song.slug, body.state.saved);
      } catch {
        updateSongFavorite(song.slug, !nextFavorite);
      }
    },
    [canFavorite, favoriteSlugs, updateSongFavorite],
  );

  const openSongDetail = useCallback((song: PublicSong, chartToken?: string) => {
    setOpenSong(song);
    setOpenSongChartToken(chartToken ?? null);
  }, []);

  const removePreviewVoice = useCallback((voice: PreviewVoice) => {
    if (voice.fadeFrame !== null) {
      window.cancelAnimationFrame(voice.fadeFrame);
      voice.fadeFrame = null;
    }

    voice.audio.pause();
    voice.audio.removeAttribute("src");
    voice.audio.load();
    voice.source?.disconnect();
    voice.compressor?.disconnect();
    voice.gain?.disconnect();
    previewVoicesRef.current = previewVoicesRef.current.filter((item) => item !== voice);
  }, []);

  const setPreviewVoiceVolume = useCallback((voice: PreviewVoice, volume: number) => {
    const nextVolume = clampPreviewVolume(volume);

    voice.volume = nextVolume;
    if (voice.gain) {
      const context = previewAudioGraphRef.current?.context;
      if (context) {
        const now = context.currentTime;
        voice.gain.gain.cancelScheduledValues(now);
        voice.gain.gain.setValueAtTime(nextVolume, now);
      } else {
        voice.gain.gain.value = nextVolume;
      }
    } else {
      voice.audio.volume = nextVolume;
    }
  }, []);

  const cancelVoiceFade = useCallback((voice: PreviewVoice) => {
    if (voice.fadeFrame !== null) {
      window.cancelAnimationFrame(voice.fadeFrame);
      voice.fadeFrame = null;
    }
  }, []);

  const fadePreviewVoice = useCallback(
    (voice: PreviewVoice, targetVolume: number, durationMs: number, onComplete?: () => void) => {
      cancelVoiceFade(voice);

      const startVolume = voice.volume;
      const target = clampPreviewVolume(targetVolume);
      if (durationMs <= 0 || Math.abs(startVolume - target) < 0.001) {
        setPreviewVoiceVolume(voice, target);
        onComplete?.();
        return;
      }

      const startTime = window.performance.now();
      const tick = (now: number) => {
        const progress = Math.min((now - startTime) / durationMs, 1);
        const eased = 1 - (1 - progress) ** 2;
        setPreviewVoiceVolume(voice, startVolume + (target - startVolume) * eased);

        if (progress < 1) {
          voice.fadeFrame = window.requestAnimationFrame(tick);
          return;
        }

        voice.fadeFrame = null;
        onComplete?.();
      };

      voice.fadeFrame = window.requestAnimationFrame(tick);
    },
    [cancelVoiceFade, setPreviewVoiceVolume],
  );

  const ensurePreviewAudioGraph = useCallback(() => {
    if (previewAudioGraphRef.current) {
      return previewAudioGraphRef.current;
    }

    if (typeof window === "undefined") {
      return null;
    }

    const AudioContextConstructor = window.AudioContext ?? (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextConstructor) {
      return null;
    }

    try {
      const context = new AudioContextConstructor();
      previewAudioGraphRef.current = { context, destination: context.destination };
      return previewAudioGraphRef.current;
    } catch {
      return null;
    }
  }, []);

  const connectPreviewVoice = useCallback((voice: PreviewVoice, graph: PreviewAudioGraph | null) => {
    if (!graph || voice.gain) {
      return;
    }

    try {
      const source = graph.context.createMediaElementSource(voice.audio);
      const compressor = graph.context.createDynamicsCompressor();
      const gain = graph.context.createGain();

      compressor.threshold.value = -18;
      compressor.knee.value = 18;
      compressor.ratio.value = 3;
      compressor.attack.value = 0.006;
      compressor.release.value = 0.18;
      gain.gain.value = voice.volume;

      source.connect(compressor);
      compressor.connect(gain);
      gain.connect(graph.destination);
      voice.audio.volume = 1;
      voice.source = source;
      voice.compressor = compressor;
      voice.gain = gain;
    } catch {
      voice.audio.volume = voice.volume;
    }
  }, []);

  const stopSongPreview = useCallback((previewUrl?: string | null, fade = true) => {
    if (previewUrl && activePreviewUrlRef.current !== previewUrl) {
      return;
    }

    activePreviewUrlRef.current = null;
    setActivePreviewUrl(null);

    const voices = previewUrl
      ? previewVoicesRef.current.filter((voice) => voice.url === previewUrl)
      : [...previewVoicesRef.current];

    for (const voice of voices) {
      if (fade && !voice.audio.paused) {
        fadePreviewVoice(voice, 0, PREVIEW_FADE_OUT_MS, () => removePreviewVoice(voice));
      } else {
        removePreviewVoice(voice);
      }
    }
  }, [fadePreviewVoice, removePreviewVoice]);

  const playSongPreview = useCallback(
    async (song: PublicSong) => {
      if (previewMuted || !song.previewUrl) {
        return;
      }

      const graph = ensurePreviewAudioGraph();
      if (graph?.context.state === "suspended") {
        await graph.context.resume().catch(() => undefined);
      }

      for (const voice of previewVoicesRef.current) {
        if (voice.url !== song.previewUrl && voice.volume > 0) {
          fadePreviewVoice(voice, 0, PREVIEW_FADE_OUT_MS, () => removePreviewVoice(voice));
        }
      }

      const existingVoice = previewVoicesRef.current.find((voice) => voice.url === song.previewUrl);
      const voice =
        existingVoice ??
        {
          id: previewVoiceIdRef.current + 1,
          url: song.previewUrl,
          audio: new Audio(song.previewUrl),
          source: null,
          compressor: null,
          gain: null,
          fadeFrame: null,
          volume: 0,
        };

      if (!existingVoice) {
        previewVoiceIdRef.current = voice.id;
        voice.audio.loop = true;
        voice.audio.preload = "auto";
        voice.audio.volume = 0;
        connectPreviewVoice(voice, graph);
        previewVoicesRef.current = [...previewVoicesRef.current, voice];
      }
      cancelVoiceFade(voice);
      activePreviewUrlRef.current = song.previewUrl;
      setActivePreviewUrl(song.previewUrl);

      try {
        await voice.audio.play();
        fadePreviewVoice(voice, previewVolume, PREVIEW_FADE_IN_MS);
      } catch {
        removePreviewVoice(voice);
        if (activePreviewUrlRef.current === song.previewUrl) {
          activePreviewUrlRef.current = null;
          setActivePreviewUrl(null);
        }
      }
    },
    [cancelVoiceFade, connectPreviewVoice, ensurePreviewAudioGraph, fadePreviewVoice, previewMuted, previewVolume, removePreviewVoice],
  );

  const togglePreviewMuted = useCallback(() => {
    if (previewMuted) {
      setPreferredPreviewMuted(false);
      savePreviewPreferences(false, previewVolume, true);
    } else {
      setPreferredPreviewMuted(true);
      savePreviewPreferences(true, previewVolume, true);
      stopSongPreview(null, false);
    }

  }, [previewMuted, previewVolume, savePreviewPreferences, stopSongPreview]);

  const changePreviewVolume = useCallback((volume: number) => {
    const nextVolume = clampPreviewVolume(volume);
    setPreviewVolume(nextVolume);
    if (nextVolume > 0 && previewMuted) {
      setPreferredPreviewMuted(false);
      savePreviewPreferences(false, nextVolume, true);
    } else if (nextVolume === 0 && !preferredPreviewMuted) {
      setPreferredPreviewMuted(true);
      savePreviewPreferences(true, nextVolume, true);
      stopSongPreview(null, false);
    }
  }, [preferredPreviewMuted, previewMuted, savePreviewPreferences, stopSongPreview]);

  useEffect(() => {
    function scrollToSearchTop(behavior: ScrollBehavior = "auto") {
      const searchSection = searchSectionRef.current;
      if (!searchSection) {
        return;
      }

      window.scrollTo({
        top: searchSection.getBoundingClientRect().top + window.scrollY,
        behavior,
      });
    }

    const frame = window.requestAnimationFrame(() => {
      if (window.location.hash === SEARCH_HASH) {
        scrollToSearchTop();
      }
    });

    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    selectedFiltersRef.current = selectedFilters;
  }, [selectedFilters]);

  useEffect(() => {
    levelModeRef.current = levelMode;
  }, [levelMode]);

  useEffect(() => {
    sortByRef.current = sortBy;
  }, [sortBy]);

  useEffect(() => {
    sortDirectionRef.current = sortDirection;
  }, [sortDirection]);

  useEffect(() => {
    favoritesFirstRef.current = favoritesFirst;
  }, [favoritesFirst]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      void runSearch(query);
    }, 260);

    return () => window.clearTimeout(timeout);
  }, [query, runSearch]);

  useEffect(() => {
    return () => {
      for (const voice of previewVoicesRef.current) {
        removePreviewVoice(voice);
      }
      void previewAudioGraphRef.current?.context.close();
      previewAudioGraphRef.current = null;
    };
  }, [removePreviewVoice]);

  useEffect(() => {
    if (!activePreviewUrlRef.current || previewMuted) {
      return;
    }

    const voice = previewVoicesRef.current.find((item) => item.url === activePreviewUrlRef.current);
    if (voice) {
      setPreviewVoiceVolume(voice, previewVolume);
    }
  }, [previewMuted, previewVolume, setPreviewVoiceVolume]);

  useEffect(() => {
    if (!canFavorite) {
      return;
    }

    if (!didMountPreviewPreferencesRef.current) {
      didMountPreviewPreferencesRef.current = true;
      return;
    }

    const timeout = window.setTimeout(() => {
      const lastSaved = lastSavedPreviewPreferencesRef.current;
      if (lastSaved?.muted === preferredPreviewMuted && lastSaved.volume === previewVolume) {
        return;
      }

      savePreviewPreferences(preferredPreviewMuted, previewVolume);
    }, 420);

    return () => window.clearTimeout(timeout);
  }, [canFavorite, preferredPreviewMuted, previewVolume, savePreviewPreferences]);

  useEffect(() => {
    if (!openSong) {
      return;
    }

    let cancelled = false;
    const songSlug = openSong.slug;
    const chartToken = openSongChartToken ?? openSong.chartSummary[0] ?? null;

    async function loadCommunity() {
      const params = chartToken ? `?${new URLSearchParams({ chart: chartToken }).toString()}` : "";
      const response = await fetch(`/api/songs/${encodeURIComponent(songSlug)}/community${params}`, { cache: "no-store" });
      if (!response.ok) {
        return;
      }
      const state = (await response.json()) as SongCommunityState;
      if (!cancelled) {
        setOpenSongCommunity({ slug: songSlug, state });
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpenSong(null);
      }
    }

    void loadCommunity();
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      cancelled = true;
      document.body.style.overflow = "";
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [openSong, openSongChartToken]);

  function scrollToSearch() {
    window.history.replaceState(null, "", SEARCH_HASH);
    const searchSection = searchSectionRef.current;
    if (!searchSection) {
      return;
    }

    window.scrollTo({
      top: searchSection.getBoundingClientRect().top + window.scrollY,
      behavior: "smooth",
    });
  }

  function toggleFilter(key: FilterKey, value: string) {
    const values = selectedFilters[key];
    const nextFilters = {
      ...selectedFilters,
      [key]: values.includes(value) ? values.filter((item) => item !== value) : [...values, value],
    };

    setSelectedFilters(nextFilters);
    void runSearch(query, null, nextFilters);
  }

  function toggleLevelMode() {
    const nextMode: LevelFilterMode = levelMode === "or" ? "and" : "or";
    setLevelMode(nextMode);
    void runSearch(query, null, selectedFilters, nextMode);
  }

  function changeSortBy(value: SongSortOption) {
    setSortBy(value);
    saveSearchControlPreferences({ sortBy: value });
    void runSearch(query, null, selectedFilters, levelMode, value, sortDirection);
  }

  function toggleSortDirection() {
    const nextDirection: SortDirection = sortDirection === "asc" ? "desc" : "asc";
    setSortDirection(nextDirection);
    saveSearchControlPreferences({ sortDirection: nextDirection });
    void runSearch(query, null, selectedFilters, levelMode, sortBy, nextDirection);
  }

  function toggleFavoritesFirst() {
    if (!canFavorite) {
      window.location.href = `/api/auth/google/login?next=${encodeURIComponent(`/${SEARCH_HASH}`)}`;
      return;
    }

    const nextFavoritesFirst = !favoritesFirst;
    setFavoritesFirst(nextFavoritesFirst);
    saveSearchControlPreferences({ favoritesFirst: nextFavoritesFirst });
    void runSearch(query, null, selectedFilters, levelMode, sortBy, sortDirection, nextFavoritesFirst);
  }

  function clearFilters() {
    const nextFilters = { folders: [], series: [], levels: [], charts: [] };
    setCompatibleFilterOptions(filterOptions);
    setTotalResults(initialSongs.length);
    setLevelMode("and");
    setSelectedFilters(nextFilters);
    void runSearch(query, null, nextFilters, "and");
  }

  async function copySongLink(song: PublicSong, chartToken: string | null = null) {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}${songDetailHref(song, chartToken)}`);
      setCopiedSongSlug(song.slug);
      window.setTimeout(() => setCopiedSongSlug((current) => (current === song.slug ? null : current)), 1200);
    } catch {
      setStatus("Could not copy link.");
    }
  }

  function renderFilterPanel() {
    return (
      <>
        <div className="mb-4 flex items-center justify-between gap-3">
          <div className="inline-flex items-center gap-2 text-sm font-black uppercase text-[#596153]">
            <Filter aria-hidden="true" size={17} />
            Filters
          </div>
          <AnimatePresence initial={false}>
            {activeFilterCount > 0 ? (
              <motion.button
                className="text-xs font-black text-[#1f7a43] hover:text-[#171916]"
                type="button"
                initial={{ opacity: 0, x: 8 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 8 }}
                whileTap={{ scale: 0.94 }}
                onClick={clearFilters}
              >
                Clear
              </motion.button>
            ) : null}
          </AnimatePresence>
        </div>

        <LevelFilterGroup
          label={levelMode === "and" ? "Levels (&)" : "Levels"}
          labelTitle="Toggle level matching"
          chartOptions={compatibleFilterOptions.charts}
          levelOptions={compatibleFilterOptions.levels}
          selectedCharts={selectedFilters.charts}
          selectedLevels={selectedFilters.levels}
          onLabelClick={toggleLevelMode}
          onToggleChart={(value) => toggleFilter("charts", value)}
          onToggleLevel={(value) => toggleFilter("levels", value)}
        />
        <FilterGroup
          label="Folder"
          options={compatibleFilterOptions.folders}
          selected={selectedFilters.folders}
          onToggle={(value) => toggleFilter("folders", value)}
        />
        <FilterGroup
          label="Series"
          options={compatibleFilterOptions.series}
          selected={selectedFilters.series}
          onToggle={(value) => toggleFilter("series", value)}
        />
      </>
    );
  }

  return (
    <MotionConfig reducedMotion="user">
      {canFavorite ? (
        <motion.section
          ref={landingSectionRef}
          className="mx-auto hidden max-w-7xl px-5 py-8 sm:block sm:px-8 lg:px-10"
          initial={{ opacity: 0, y: 18 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-80px" }}
          transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        >
          <div className="mb-5 flex items-end justify-between gap-4">
            <div>
              <h2 className="text-2xl font-black text-[#11130f]">New Songs</h2>
              <p className="mt-1 text-sm font-medium text-[#66705f]">PHOENIX 2 released 07/2026</p>
            </div>
            <PreviewToggleButton
              muted={previewMuted}
              volume={previewVolume}
              onVolumeChange={changePreviewVolume}
              onToggle={togglePreviewMuted}
            />
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6">
            {favoritedInitialSongs.map((song, index) => (
              <div key={`new-${song.slug}`} className={landingSongVisibilityClass(index)}>
                <SongCard
                  onOpen={openSongDetail}
                  isPreviewActive={Boolean(song.previewUrl && activePreviewUrl === song.previewUrl)}
                  previewEnabled={previewEnabled}
                  onPreviewStart={playSongPreview}
                  onPreviewStop={() => stopSongPreview(song.previewUrl)}
                  sequence={index}
                  song={song}
                />
              </div>
            ))}
          </div>

          <div className="mt-8 flex justify-center">
            <motion.button
              className="inline-flex items-center gap-2 border border-[#171916] bg-[#171916] px-6 py-3 font-bold text-white transition hover:bg-[#343b30]"
              type="button"
              whileHover={{ y: -3, scale: 1.03 }}
              whileTap={{ scale: 0.97 }}
              onClick={scrollToSearch}
            >
              View More
              <motion.span
                animate={{ y: [0, 4, 0] }}
                transition={{ duration: 1.4, repeat: Infinity, ease: "easeInOut" }}
              >
                <ChevronDown aria-hidden="true" size={18} />
              </motion.span>
            </motion.button>
          </div>
        </motion.section>
      ) : (
        <GuestFeatureShowcase featureSong={featureSong ?? favoritedInitialSongs[0] ?? null} onExplore={scrollToSearch} />
      )}

      <motion.section
        ref={searchSectionRef}
        id="search"
        className="min-h-screen border-t border-[#d9ded2] bg-[#eef1e8]"
        initial={{ opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, amount: 0.08 }}
        transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
      >
        <div className="mx-auto grid max-w-7xl gap-5 px-5 py-8 sm:px-8 lg:grid-cols-[260px_minmax(0,1fr)] lg:px-10">
          <motion.aside
            ref={filterPanelRef}
            className="hidden self-start border border-[#d6ddcf] bg-white p-4 lg:block"
            initial={{ opacity: 0, x: -18 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
          >
            {renderFilterPanel()}
          </motion.aside>

          <AnimatePresence>
            {mobileFiltersOpen ? (
              <motion.div
                className="fixed inset-0 z-40 bg-[#171916]/42 backdrop-blur-sm lg:hidden"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onMouseDown={(event) => {
                  if (event.target === event.currentTarget) {
                    setMobileFiltersOpen(false);
                  }
                }}
              >
                <motion.aside
                  className="absolute bottom-0 left-0 right-0 max-h-[82vh] overflow-y-auto border-t border-[#d6ddcf] bg-white p-4 shadow-[0_-20px_60px_rgba(17,19,15,0.18)]"
                  initial={{ y: "100%" }}
                  animate={{ y: 0 }}
                  exit={{ y: "100%" }}
                  transition={{ type: "spring", stiffness: 320, damping: 32 }}
                >
                  <div className="mb-4 flex justify-end">
                    <button
                      aria-label="Close filters"
                      className="inline-flex size-10 items-center justify-center border border-[#cfd7c8] bg-white text-[#343b30]"
                      type="button"
                      onClick={() => setMobileFiltersOpen(false)}
                    >
                      <X aria-hidden="true" size={18} />
                    </button>
                  </div>
                  {renderFilterPanel()}
                </motion.aside>
              </motion.div>
            ) : null}
          </AnimatePresence>

          <div>
            <motion.div
              className="mb-3 grid gap-3 border-y border-[#d9ded2] py-4 lg:grid-cols-[minmax(260px,1fr)_auto] lg:items-center"
              layout
            >
              <motion.label
                className="search-field flex min-h-11 items-center gap-3 border border-[#cfd7c8] bg-white px-3"
                whileHover={{ y: -2, boxShadow: "0 12px 28px rgba(30,34,26,0.10)" }}
              >
                <Search aria-hidden="true" size={18} className="shrink-0 text-[#626c5c]" />
                <input
                  className="w-full bg-transparent text-base outline-none placeholder:text-[#8b9483]"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      void runSearch(query);
                    }
                  }}
                  placeholder="Search title, artist, folder, series, tag, or chart"
                />
              </motion.label>
              <div className="grid min-h-11 grid-cols-[minmax(0,1fr)_2.75rem_2.75rem_2.75rem] items-center border border-[#cfd7c8] bg-white text-sm font-bold uppercase text-[#596153] lg:min-w-[16.75rem] lg:grid-cols-[minmax(11rem,1fr)_2.75rem_2.75rem]">
                <label className="relative h-full">
                  <span className="sr-only">Sort by</span>
                  <select
                    className="h-full min-h-11 w-full appearance-none bg-transparent py-2 pl-3 pr-9 text-sm font-black uppercase text-[#171916] outline-none"
                    value={sortBy}
                    onChange={(event) => changeSortBy(toSongSortOption(event.target.value))}
                  >
                    {SORT_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  <ChevronDown
                    aria-hidden="true"
                    className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[#626c5c]"
                    size={17}
                  />
                </label>
                <motion.button
                  aria-label={favoritesFirst ? "Show favorites first" : "Keep favorites in regular order"}
                  aria-pressed={favoritesFirst}
                  className={`flex h-full min-h-11 items-center justify-center border-l border-[#d9ded2] transition hover:bg-[#eef1e8] ${
                    favoritesFirst ? "bg-[#fff4cf] text-[#c78215]" : "text-[#171916]"
                  }`}
                  title={canFavorite ? "Show favorites first" : "Sign in to sort favorites first"}
                  type="button"
                  whileTap={{ scale: 0.9 }}
                  onClick={toggleFavoritesFirst}
                >
                  <Star aria-hidden="true" fill={favoritesFirst ? "currentColor" : "none"} size={18} />
                </motion.button>
                <motion.button
                  aria-label={sortDirection === "asc" ? "Sort ascending" : "Sort descending"}
                  aria-pressed={sortDirection === "desc"}
                  className="flex h-full min-h-11 items-center justify-center border-l border-[#d9ded2] text-[#171916] transition hover:bg-[#eef1e8]"
                  title={sortDirection === "asc" ? "Sort ascending" : "Sort descending"}
                  type="button"
                  whileTap={{ scale: 0.9 }}
                  onClick={toggleSortDirection}
                >
                  <AnimatePresence mode="wait" initial={false}>
                    <motion.span
                      key={sortDirection}
                      initial={{ opacity: 0, y: -5 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: 5 }}
                      transition={{ duration: 0.16 }}
                    >
                      {sortDirection === "asc" ? <ListSortAscending aria-hidden="true" size={18} /> : <ListSortDescending aria-hidden="true" size={18} />}
                    </motion.span>
                  </AnimatePresence>
                </motion.button>
                <motion.button
                  aria-label={`Open filters${activeFilterCount > 0 ? `, ${activeFilterCount} active` : ""}`}
                  aria-pressed={mobileFiltersOpen}
                  className="relative flex h-full min-h-11 items-center justify-center border-l border-[#d9ded2] text-[#171916] transition hover:bg-[#eef1e8] lg:hidden"
                  title="Filters"
                  type="button"
                  whileTap={{ scale: 0.9 }}
                  onClick={() => setMobileFiltersOpen(true)}
                >
                  <Filter aria-hidden="true" size={18} />
                  {activeFilterCount > 0 ? (
                    <span className="absolute right-1.5 top-1.5 h-2 w-2 bg-[#28c950]" />
                  ) : null}
                </motion.button>
              </div>
            </motion.div>

            <div className="mb-3 flex min-h-11 items-center justify-between gap-4">
              <div className="flex min-w-0 items-center gap-3">
                <motion.div
                  className="text-xs font-black uppercase text-[#697362]"
                  initial={false}
                  animate={{ opacity: loadingMode === "replace" ? 0.62 : 1 }}
                  transition={{ duration: 0.18 }}
                  aria-live="polite"
                >
                  {resultCountLabel(totalResults, loadingMode)}
                </motion.div>
                <AnimatePresence>
                  {status ? (
                    <motion.p
                      className="truncate text-sm font-medium text-[#697362]"
                      initial={{ opacity: 0, y: -6 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: 6 }}
                    >
                      {status}
                    </motion.p>
                  ) : null}
                </AnimatePresence>
              </div>
              <PreviewToggleButton
                muted={previewMuted}
                volume={previewVolume}
                onVolumeChange={changePreviewVolume}
                onToggle={togglePreviewMuted}
              />
            </div>

            <div className="relative min-h-[520px]">
              <motion.div
                key={`songs-${resultBatch}`}
                className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: loadingMode === "replace" ? 0.18 : 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.24 }}
                layout
              >
                {songs.map((song, index) => (
                    <SongCard
                    key={`catalog-${resultBatch}-${song.version}-${song.slug}`}
                    onOpen={openSongDetail}
                    isPreviewActive={Boolean(song.previewUrl && activePreviewUrl === song.previewUrl)}
                    previewEnabled={previewEnabled}
                    onPreviewStart={playSongPreview}
                    onPreviewStop={() => stopSongPreview(song.previewUrl)}
                    sequence={index}
                    song={song}
                  />
                ))}
                {loadingMode === "append" ? <SongSkeletonGrid count={5} /> : null}
              </motion.div>

              <AnimatePresence>
                {loadingMode === "replace" ? (
                  <motion.div
                    key="skeleton-replace"
                    className="absolute left-0 right-0 top-0 z-10 grid grid-cols-2 gap-3 bg-[#eef1e8] sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5"
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
                    aria-hidden="true"
                  >
                    <SongSkeletonGrid count={Math.max(10, Math.min(songs.length || 10, 20))} />
                  </motion.div>
                ) : null}
              </AnimatePresence>
            </div>

            <AnimatePresence>
              {nextCursor ? (
                <motion.div
                  className="mt-8 flex justify-center"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 10 }}
                >
                  <motion.button
                    className="border border-[#171916] bg-[#171916] px-6 py-3 font-bold text-white transition hover:bg-[#343b30] disabled:opacity-60"
                    disabled={loadingMode !== null}
                    type="button"
                    whileHover={loadingMode !== null ? undefined : { y: -3, scale: 1.03 }}
                    whileTap={loadingMode !== null ? undefined : { scale: 0.97 }}
                    onClick={() => void runSearch(query, nextCursor)}
                  >
                    Load more
                  </motion.button>
                </motion.div>
              ) : null}
            </AnimatePresence>
          </div>
        </div>
      </motion.section>

      <SongDetailNotebook
        canFavorite={canFavorite}
        copied={openSong ? copiedSongSlug === openSong.slug : false}
        isFavorite={openSong ? favoriteSlugs.has(openSong.slug) || Boolean(openSong.isFavorite) : false}
        song={openSong}
        selectedChartToken={openSongChartToken}
        communityState={openSong && openSongCommunity?.slug === openSong.slug ? openSongCommunity.state : null}
        previewVolume={previewVolume}
        userIsAdmin={userIsAdmin}
        onClose={() => {
          setOpenSong(null);
          setOpenSongChartToken(null);
        }}
        onCopy={copySongLink}
        onToggleFavorite={toggleFavorite}
      />
    </MotionConfig>
  );
}

function landingSongVisibilityClass(index: number): string {
  if (index < 4) {
    return "block";
  }
  if (index < 6) {
    return "hidden sm:block";
  }
  if (index < 8) {
    return "hidden md:block";
  }
  if (index < 12) {
    return "hidden xl:block";
  }

  return "hidden";
}

function clampPreviewVolume(volume: number): number {
  return Number.isFinite(volume) ? Math.min(Math.max(volume, 0), 1) : 0.75;
}

function PreviewToggleButton({
  muted,
  volume,
  onVolumeChange,
  onToggle,
}: {
  muted: boolean;
  volume: number;
  onVolumeChange: (volume: number) => void;
  onToggle: () => void;
}) {
  const [volumeOpen, setVolumeOpen] = useState(false);
  const volumePercent = Math.round(volume * 100);

  return (
    <motion.div
      className="relative z-30 inline-flex shrink-0 items-center"
      onMouseEnter={() => setVolumeOpen(true)}
      onMouseLeave={() => setVolumeOpen(false)}
      onFocus={() => setVolumeOpen(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
          setVolumeOpen(false);
        }
      }}
    >
      <AnimatePresence>
        {volumeOpen ? (
          <motion.label
            className="absolute right-[calc(100%+0.5rem)] top-1/2 flex h-11 w-36 -translate-y-1/2 items-center gap-2 border border-[#cfd7c8] bg-white px-3 shadow-[0_12px_28px_rgba(30,34,26,0.12)]"
            initial={{ opacity: 0, x: 16, scaleX: 0.86 }}
            animate={{ opacity: 1, x: 0, scaleX: 1 }}
            exit={{ opacity: 0, x: 12, scaleX: 0.9 }}
            style={{ originX: 1 }}
            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
          >
            <span className="sr-only">Preview volume</span>
            <input
              aria-label="Preview volume"
              className="preview-volume-slider min-w-0 flex-1"
              max={100}
              min={0}
              type="range"
              value={volumePercent}
              onChange={(event) => onVolumeChange(Number(event.target.value) / 100)}
            />
            <span className="w-8 text-right text-[11px] font-black tabular-nums text-[#596153]">{volumePercent}</span>
          </motion.label>
        ) : null}
      </AnimatePresence>

      <motion.button
        aria-label={muted ? "Enable hover previews" : "Disable hover previews"}
        aria-pressed={!muted}
        className="inline-flex size-11 shrink-0 items-center justify-center border border-[#cfd7c8] bg-white font-semibold text-[#343b30] transition hover:bg-[#eef1e8]"
        title={muted ? "Enable hover previews" : "Disable hover previews"}
        type="button"
        whileHover={{ y: -2, scale: 1.05 }}
        whileTap={{ scale: 0.92 }}
        onClick={onToggle}
      >
        <AnimatePresence mode="wait" initial={false}>
          <motion.span
            key={muted ? "volume-off" : "volume-on"}
            initial={{ opacity: 0, rotate: -45, scale: 0.78 }}
            animate={{ opacity: 1, rotate: 0, scale: 1 }}
            exit={{ opacity: 0, rotate: 45, scale: 0.78 }}
            transition={{ duration: 0.18 }}
          >
            {muted ? <VolumeX aria-hidden="true" size={18} /> : <Volume2 aria-hidden="true" size={18} />}
          </motion.span>
        </AnimatePresence>
      </motion.button>
    </motion.div>
  );
}

function SongDetailNotebook({
  canFavorite,
  copied,
  isFavorite,
  song,
  selectedChartToken,
  communityState,
  previewVolume,
  userIsAdmin,
  onClose,
  onCopy,
  onToggleFavorite,
}: {
  canFavorite: boolean;
  copied: boolean;
  isFavorite: boolean;
  song: PublicSong | null;
  selectedChartToken: string | null;
  communityState: SongCommunityState | null;
  previewVolume: number;
  userIsAdmin: boolean;
  onClose: () => void;
  onCopy: (song: PublicSong, chartToken?: string | null) => void;
  onToggleFavorite: (song: PublicSong) => void;
}) {
  const notebookRef = useRef<HTMLDivElement | null>(null);
  const resizingNotebookRef = useRef(false);
  const pendingNotebookSizeRef = useRef<{ width: number; height: number } | null>(null);
  const [notebookSize, setNotebookSize] = useState(readStoredNotebookSize);

  useEffect(() => {
    const element = notebookRef.current;
    if (!element || typeof ResizeObserver === "undefined") {
      return;
    }

    const observer = new ResizeObserver(([entry]) => {
      const { height, width } = entry.contentRect;
      const nextSize = clampNotebookSize({ width: Math.round(width), height: Math.round(height) });
      pendingNotebookSizeRef.current = nextSize;

      if (resizingNotebookRef.current) {
        setNotebookSize((current) => (current?.width === nextSize.width && current.height === nextSize.height ? current : nextSize));
      }
    });

    observer.observe(element);
    return () => observer.disconnect();
  }, [song]);

  useEffect(() => {
    function finishResize() {
      if (!resizingNotebookRef.current) {
        return;
      }

      resizingNotebookRef.current = false;
      if (pendingNotebookSizeRef.current) {
        const nextSize = pendingNotebookSizeRef.current;
        setNotebookSize(nextSize);
        writeStoredNotebookSize(nextSize);
      }
    }

    window.addEventListener("pointerup", finishResize);
    window.addEventListener("pointercancel", finishResize);
    window.addEventListener("blur", finishResize);

    return () => {
      window.removeEventListener("pointerup", finishResize);
      window.removeEventListener("pointercancel", finishResize);
      window.removeEventListener("blur", finishResize);
    };
  }, []);

  function maybeStartResize(event: React.PointerEvent<HTMLDivElement>) {
    const element = notebookRef.current;
    if (!element) {
      return;
    }

    const rect = element.getBoundingClientRect();
    const isResizeHandle =
      event.clientX >= rect.right - NOTEBOOK_RESIZE_HANDLE_SIZE &&
      event.clientY >= rect.bottom - NOTEBOOK_RESIZE_HANDLE_SIZE;

    if (isResizeHandle) {
      resizingNotebookRef.current = true;
      pendingNotebookSizeRef.current = clampNotebookSize({ width: Math.round(rect.width), height: Math.round(rect.height) });
    }
  }

  return (
    <AnimatePresence>
      {song ? (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#171916]/45 px-3 py-5 backdrop-blur-sm sm:px-6"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          role="dialog"
          aria-modal="true"
          aria-label={`${song.title} details`}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              onClose();
            }
          }}
        >
            <motion.div
              ref={notebookRef}
              className="notebook-modal relative flex h-[min(92vh,880px)] w-[min(94vw,1180px)] flex-col overflow-hidden rounded-2xl border border-[#d6ddcf] bg-[#fbfcf7] shadow-[0_30px_90px_rgba(12,18,10,0.32)]"
              initial={{ opacity: 0, y: 24, scale: 0.96, rotate: -0.4 }}
              animate={{ opacity: 1, y: 0, scale: 1, rotate: 0 }}
              exit={{ opacity: 0, y: 18, scale: 0.97 }}
            transition={{ type: "spring", stiffness: 260, damping: 28 }}
              style={notebookSize ? { height: notebookSize.height, width: notebookSize.width } : undefined}
              onPointerDown={maybeStartResize}
          >
            <div className="absolute right-7 top-8 z-20 flex shrink-0 items-center gap-2">
              <CatalogAdminEditor label="song details" song={song} userIsAdmin={userIsAdmin} />
              <a
                aria-label="Open full song page"
                className="notebook-action inline-flex size-10 items-center justify-center border border-[#cfd7c8] bg-white/90 text-[#343b30] shadow-[0_8px_22px_rgba(30,34,26,0.10)] backdrop-blur transition hover:bg-[#eef1e8]"
                href={songDetailHref(song, selectedChartToken)}
                title="Open full song page"
              >
                <ExternalLink aria-hidden="true" size={17} />
              </a>
              <button
                aria-label={copied ? "Song link copied" : "Copy song link"}
                className="notebook-action inline-flex size-10 items-center justify-center border border-[#cfd7c8] bg-white/90 text-[#343b30] shadow-[0_8px_22px_rgba(30,34,26,0.10)] backdrop-blur transition hover:bg-[#eef1e8]"
                title={copied ? "Copied" : "Copy song link"}
                type="button"
                onClick={() => onCopy(song, selectedChartToken)}
              >
                <Link2 aria-hidden="true" size={17} />
              </button>
              <button
                aria-label={isFavorite ? "Remove favorite" : "Favorite song"}
                className={`notebook-action inline-flex size-10 items-center justify-center border bg-white/90 shadow-[0_8px_22px_rgba(30,34,26,0.10)] backdrop-blur transition hover:bg-[#eef1e8] ${isFavorite ? "border-[#e2cd96] text-[#ffca6d]" : "border-[#cfd7c8] text-[#8d9687]"}`}
                title={canFavorite ? (isFavorite ? "Remove favorite" : "Favorite song") : "Sign in to favorite"}
                type="button"
                onClick={() => onToggleFavorite(song)}
              >
                <Star aria-hidden="true" fill={isFavorite ? "currentColor" : "none"} size={17} />
              </button>
              <button
                aria-label="Close song details"
                className="notebook-action inline-flex size-10 items-center justify-center border border-[#cfd7c8] bg-white/90 text-[#343b30] shadow-[0_8px_22px_rgba(30,34,26,0.10)] backdrop-blur transition hover:bg-[#eef1e8]"
                type="button"
                onClick={onClose}
              >
                <X aria-hidden="true" size={18} />
              </button>
            </div>
            <div className="notebook-scroll h-full overflow-y-auto bg-[#f7f8f2]">
              <SongDetailView
                key={`${song.slug}:${selectedChartToken ?? ""}`}
                mode="notebook"
                song={song}
                initialSelectedChartToken={selectedChartToken}
                previewVolume={previewVolume}
                community={{ user: null, initialState: communityState ?? EMPTY_COMMUNITY_STATE }}
                communityReadOnly
                onBack={onClose}
              />
            </div>
            <div aria-hidden="true" className="notebook-resize-cue" />
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

function readStoredNotebookSize(): { width: number; height: number } | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const stored = window.localStorage.getItem(NOTEBOOK_SIZE_STORAGE_KEY);
    if (!stored) {
      return null;
    }

    const value = JSON.parse(stored) as Partial<{ width: unknown; height: unknown }>;
    if (typeof value.width !== "number" || typeof value.height !== "number" || !Number.isFinite(value.width) || !Number.isFinite(value.height)) {
      return null;
    }

    return clampNotebookSize({ width: value.width, height: value.height });
  } catch {
    return null;
  }
}

function writeStoredNotebookSize(size: { width: number; height: number }) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(NOTEBOOK_SIZE_STORAGE_KEY, JSON.stringify(size));
  } catch {
    // Storage can be unavailable in private or restricted browser contexts.
  }
}

function clampNotebookSize(size: { width: number; height: number }): { width: number; height: number } {
  if (typeof window === "undefined") {
    return size;
  }

  return {
    width: Math.min(Math.max(size.width, Math.min(672, window.innerWidth * 0.94)), window.innerWidth * 0.94),
    height: Math.min(Math.max(size.height, Math.min(544, window.innerHeight * 0.82)), window.innerHeight * 0.92),
  };
}

function songDetailHref(song: PublicSong, chartToken: string | null = null): string {
  if (!chartToken) {
    return `/songs/${song.slug}`;
  }

  return `/songs/${song.slug}?chart=${encodeURIComponent(chartToken)}`;
}

function FilterGroup({
  label,
  labelTitle,
  options,
  selected,
  onLabelClick,
  onToggle,
  formatLabel = defaultFilterLabel,
}: {
  label: string;
  labelTitle?: string;
  options: string[];
  selected: string[];
  onLabelClick?: () => void;
  onToggle: (value: string) => void;
  formatLabel?: (value: string) => string;
}) {
  if (options.length === 0) {
    return null;
  }

  return (
    <fieldset className="border-t border-[#e1e6dc] py-1">
      <legend className="mb-2 text-xs font-black uppercase text-[#778171]">
        {onLabelClick ? (
          <button className="font-black uppercase hover:text-[#28c950]" title={labelTitle} type="button" onClick={onLabelClick}>
            {label}
          </button>
        ) : (
          label
        )}
      </legend>
      <AnimatedFilterOptions
        formatLabel={formatLabel}
        layoutClassName={label.startsWith("Levels") ? "grid grid-cols-4 gap-2 transition-[grid-template-columns] duration-200 ease-out" : "flex flex-wrap gap-2 pr-1"}
        options={options}
        selected={selected}
        onToggle={onToggle}
      />
    </fieldset>
  );
}

function LevelFilterGroup({
  label,
  labelTitle,
  chartOptions,
  levelOptions,
  selectedCharts,
  selectedLevels,
  onLabelClick,
  onToggleChart,
  onToggleLevel,
}: {
  label: string;
  labelTitle?: string;
  chartOptions: string[];
  levelOptions: string[];
  selectedCharts: string[];
  selectedLevels: string[];
  onLabelClick: () => void;
  onToggleChart: (value: string) => void;
  onToggleLevel: (value: string) => void;
}) {
  if (chartOptions.length === 0 && levelOptions.length === 0) {
    return null;
  }

  return (
    <fieldset className="border-t border-[#e1e6dc] py-1">
      <legend className="mb-2 text-xs font-black uppercase text-[#778171]">
        <button className="font-black uppercase hover:text-[#28c950]" title={labelTitle} type="button" onClick={onLabelClick}>
          {label}
        </button>
      </legend>
      <AnimatedFilterOptions
        chipClassName="w-full"
        formatLabel={chartFilterLabel}
        layoutClassName="mb-3 grid grid-cols-3 gap-2"
        options={chartOptions}
        selected={selectedCharts}
        onToggle={onToggleChart}
      />
      <AnimatedFilterOptions
        layoutClassName="grid grid-cols-4 gap-2 transition-[grid-template-columns] duration-200 ease-out pb-1"
        options={levelOptions}
        selected={selectedLevels}
        onToggle={onToggleLevel}
      />
    </fieldset>
  );
}

function AnimatedFilterOptions({
  options,
  selected,
  onToggle,
  layoutClassName,
  chipClassName = "",
  formatLabel = defaultFilterLabel,
}: {
  options: string[];
  selected: string[];
  onToggle: (value: string) => void;
  layoutClassName: string;
  chipClassName?: string;
  formatLabel?: (value: string) => string;
}) {
  const [renderedOptions, setRenderedOptions] = useState(options);
  const [exitingOptions, setExitingOptions] = useState<string[]>([]);
  const renderedOptionsRef = useRef(options);

  useEffect(() => {
    renderedOptionsRef.current = renderedOptions;
  }, [renderedOptions]);

  useEffect(() => {
    const removedOptions = renderedOptionsRef.current.filter((option) => !options.includes(option));
    const nextRenderedOptions = removedOptions.length === 0 ? options : Array.from(new Set([...options, ...renderedOptionsRef.current]));

    renderedOptionsRef.current = nextRenderedOptions;
    setRenderedOptions(nextRenderedOptions);
    setExitingOptions((current) => {
      const retainedExits = current.filter((option) => !options.includes(option));
      return removedOptions.length === 0 ? retainedExits : Array.from(new Set([...retainedExits, ...removedOptions]));
    });

    if (removedOptions.length === 0) {
      return;
    }

    const timeout = window.setTimeout(() => {
      renderedOptionsRef.current = options;
      setRenderedOptions(options);
      setExitingOptions((current) => current.filter((option) => options.includes(option)));
    }, 220);

    return () => window.clearTimeout(timeout);
  }, [options]);

  if (renderedOptions.length === 0) {
    return null;
  }

  return (
    <div className={layoutClassName}>
      {renderedOptions.map((option) => {
        const checked = selected.includes(option);
        const exiting = exitingOptions.includes(option);
        return (
          <motion.button
            key={option}
            layout
            aria-pressed={checked}
            className={`filter-chip inline-flex min-h-8 min-w-0 items-center justify-center overflow-hidden whitespace-nowrap border px-2 text-xs font-black transition ${chipClassName} ${
              checked ? "border-[#28c950] bg-[#eef7ed] text-[#1f5f39]" : "border-[#d8dfd1] bg-white text-[#3d4638] hover:bg-[#f5f7f0]"
            } ${exiting ? "filter-chip-exit pointer-events-none" : ""}`}
            disabled={exiting}
            initial={false}
            animate={exiting ? { opacity: 0, scale: 0.72 } : { opacity: 1, scale: checked ? 1.04 : 1 }}
            whileHover={exiting ? undefined : { y: -2, scale: checked ? 1.06 : 1.03 }}
            whileTap={exiting ? undefined : { scale: 0.94 }}
            transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
            type="button"
            onClick={() => onToggle(option)}
          >
            {formatLabel(option)}
          </motion.button>
        );
      })}
    </div>
  );
}

function SongSkeletonGrid({ count }: { count: number }) {
  return Array.from({ length: count }, (_, index) => <SongSkeleton key={index} sequence={index} />);
}

function SongSkeleton({ sequence }: { sequence: number }) {
  const delay = `${Math.min(sequence, 9) * 42}ms`;
  const motionDelay = Math.min(sequence, 9) * 0.042;

  return (
    <motion.div
      className="h-full"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ delay: motionDelay, duration: 0.26, ease: [0.22, 1, 0.36, 1] }}
      layout
    >
      <article className="flex h-full flex-col overflow-hidden border border-[#d6ddcf] bg-white shadow-[0_10px_30px_rgba(30,34,26,0.06)]">
        <div className="relative aspect-square bg-[#e8ece1]">
          <div className="skeleton-sheen absolute inset-0 bg-[#dfe5d8]" style={{ animationDelay: delay }} />
        </div>
        <div className="flex min-h-16 flex-col p-3">
          <div className="skeleton-sheen h-4 w-4/5 bg-[#dfe5d8]" style={{ animationDelay: delay }} />
          <div className="skeleton-sheen mt-1.5 h-3 w-2/3 bg-[#e8ece1]" style={{ animationDelay: delay }} />
        </div>
      </article>
    </motion.div>
  );
}

function toSongSortOption(value: string): SongSortOption {
  return value === "title" || value === "artist" || value === "folder" ? value : "series";
}

function resultCountLabel(total: number, loadingMode: LoadingMode): string {
  if (loadingMode === "replace") {
    return "Updating results";
  }

  if (total === 0) {
    return "0 results";
  }

  const formattedTotal = total.toLocaleString();
  return `${formattedTotal} ${total === 1 ? "result" : "results"}`;
}

function defaultFilterLabel(value: string): string {
  return value.toUpperCase();
}

function chartFilterLabel(value: string): string {
  if (value === "singles") {
    return "SINGLES";
  }
  if (value === "doubles") {
    return "DOUBLES";
  }
  if (value === "co-op") {
    return "CO-OP";
  }
  return value.toUpperCase();
}
