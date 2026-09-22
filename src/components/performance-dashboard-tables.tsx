"use client";

import { ArrowDownWideNarrow, BarChart3, Clock3, ExternalLink, ImageIcon, Link2, RefreshCw, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import Image from "next/image";
import { useEffect, useRef, useState, useSyncExternalStore, type UIEvent } from "react";

import { SongDetailView } from "@/components/song-detail-view";
import type { PublicUser, SongCommunityState } from "@/lib/auth";
import { formatPerformanceGrade, isFailedPerformanceGrade, piuTimestampToDate } from "@/lib/performance-format";
import { getPerformanceRefreshServerState, getPerformanceRefreshState, subscribePerformanceRefreshState } from "@/lib/performance-refresh-events";
import type { PiuCatalogVersion, PublicSong } from "@/lib/types";

interface TopChartRow {
  songName: string;
  chartToken: string;
  bestScore: number | null;
  previousBestScore: number | null;
  bestGrade: string | null;
  bestPlate: string | null;
  mode: string | null;
  level: string | null;
  bestBucketPage: number | null;
  bestSyncedAt: string | null;
  topPlayRank: number | null;
  topPumbilityScore: number | null;
  topPlayedAt: string | null;
  topPlaysSyncedAt: string | null;
  song: PublicSong | null;
}

interface RecentPlayRow {
  songName: string;
  chartToken: string;
  score: number | null;
  grade: string | null;
  plate: string | null;
  mode: string | null;
  level: string | null;
  playedAt: string | null;
  stageBreak: boolean;
  song: PublicSong | null;
}

interface RecentPlaysResponse {
  recentPlays: RecentPlayRow[];
  nextOffset: number | null;
  total: number;
  error?: string;
}

type TopChartsSort = "pumbility" | "score";

interface TopChartsResponse {
  topCharts: TopChartRow[];
  nextOffset: number | null;
  total: number;
  sort: TopChartsSort;
  error?: string;
}

const EMPTY_COMMUNITY_STATE: SongCommunityState = {
  saved: false,
  note: "",
  userTags: [],
  communityTags: [],
  tagVotes: [],
  posts: [],
};

const PANEL_CLASS = "flex h-[44rem] max-h-[calc(100vh-8rem)] min-h-[32rem] min-w-0 flex-col border border-[#d9ded2] bg-white";

export function PerformanceDashboardTables({
  lastFetchedAt,
  nextTopChartsOffset,
  nextRecentPlaysOffset,
  recentArcade,
  recentPlays,
  totalRecentPlays,
  totalTopCharts,
  topCharts,
  previewVolume,
  performanceVersion,
  communityUser,
}: {
  lastFetchedAt: string | null | undefined;
  nextTopChartsOffset: number | null;
  nextRecentPlaysOffset: number | null;
  recentArcade: string | null | undefined;
  recentPlays: RecentPlayRow[];
  totalRecentPlays: number;
  totalTopCharts: number;
  topCharts: TopChartRow[];
  previewVolume: number;
  performanceVersion: PiuCatalogVersion;
  communityUser: PublicUser | null;
}) {
  const loadingTopChartsRef = useRef(false);
  const loadingRecentPlaysRef = useRef(false);
  const [openSong, setOpenSong] = useState<PublicSong | null>(null);
  const [openChartToken, setOpenChartToken] = useState<string | null>(null);
  const [openSongCommunity, setOpenSongCommunity] = useState<{ slug: string; state: SongCommunityState } | null>(null);
  const [copiedSongSlug, setCopiedSongSlug] = useState<string | null>(null);
  const [topSort, setTopSort] = useState<TopChartsSort>("pumbility");
  const [visibleTopCharts, setVisibleTopCharts] = useState(topCharts);
  const [nextTopOffset, setNextTopOffset] = useState(nextTopChartsOffset);
  const [topTotal, setTopTotal] = useState(totalTopCharts);
  const [topStatus, setTopStatus] = useState("");
  const [visibleRecentPlays, setVisibleRecentPlays] = useState(recentPlays);
  const [nextRecentOffset, setNextRecentOffset] = useState(nextRecentPlaysOffset);
  const [recentTotal, setRecentTotal] = useState(totalRecentPlays);
  const [recentStatus, setRecentStatus] = useState("");
  const pageRefreshState = useSyncExternalStore(subscribePerformanceRefreshState, getPerformanceRefreshState, getPerformanceRefreshServerState);

  useEffect(() => {
    if (!openSong) {
      return;
    }

    let cancelled = false;
    const songSlug = openSong.slug;
    const chartToken = openChartToken ?? openSong.chartSummary[0] ?? null;

    async function loadCommunity() {
      const params = `?${new URLSearchParams({ version: performanceVersion, ...(chartToken ? { chart: chartToken } : {}) }).toString()}`;
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
        closeNotebook();
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
  }, [openChartToken, openSong, performanceVersion]);

  async function changeTopSort(sort: TopChartsSort) {
    if (sort === topSort && visibleTopCharts.length > 0) {
      return;
    }

    loadingTopChartsRef.current = true;
    setTopSort(sort);
    setTopStatus("Loading");
    setVisibleTopCharts([]);
    setNextTopOffset(null);
    try {
      const body = await fetchTopCharts({ offset: 0, sort });
      setVisibleTopCharts(body.topCharts);
      setNextTopOffset(body.nextOffset);
      setTopTotal(body.total);
      setTopStatus("");
    } catch (error) {
      setTopStatus(error instanceof Error ? error.message : "Could not load charts.");
    } finally {
      loadingTopChartsRef.current = false;
    }
  }

  function openNotebook(song: PublicSong, chartToken: string | null) {
    setOpenSong(song);
    setOpenChartToken(chartToken && song.chartSummary.includes(chartToken) ? chartToken : song.chartSummary[0] ?? null);
    setOpenSongCommunity(null);
  }

  function closeNotebook() {
    setOpenSong(null);
    setOpenChartToken(null);
    setOpenSongCommunity(null);
  }

  async function copySongLink(song: PublicSong, chartToken: string | null = null) {
    await navigator.clipboard?.writeText(`${window.location.origin}${songDetailHref(song, performanceVersion, chartToken)}`).catch(() => undefined);
    setCopiedSongSlug(song.slug);
    window.setTimeout(() => setCopiedSongSlug((current) => (current === song.slug ? null : current)), 1200);
  }

  async function loadMoreRecentPlays() {
    if (loadingRecentPlaysRef.current || nextRecentOffset === null) {
      return;
    }

    loadingRecentPlaysRef.current = true;
    setRecentStatus("Loading");
    try {
      const response = await fetch(`/api/performance/recent?${new URLSearchParams({ offset: String(nextRecentOffset), limit: "35" }).toString()}`, { cache: "no-store" });
      const body = (await response.json().catch(() => null)) as RecentPlaysResponse | null;
      if (!response.ok || !body) {
        setRecentStatus(body?.error ?? "Could not load more plays.");
        return;
      }

      setVisibleRecentPlays((current) => appendUniqueRecentPlays(current, body.recentPlays));
      setNextRecentOffset(body.nextOffset);
      setRecentTotal(body.total);
      setRecentStatus("");
    } catch {
      setRecentStatus("Could not load more plays.");
    } finally {
      loadingRecentPlaysRef.current = false;
    }
  }

  async function loadMoreTopCharts() {
    if (loadingTopChartsRef.current || nextTopOffset === null) {
      return;
    }

    loadingTopChartsRef.current = true;
    setTopStatus("Loading");
    try {
      const body = await fetchTopCharts({ offset: nextTopOffset, sort: topSort });
      setVisibleTopCharts((current) => appendUniqueTopCharts(current, body.topCharts));
      setNextTopOffset(body.nextOffset);
      setTopTotal(body.total);
      setTopStatus("");
    } catch (error) {
      setTopStatus(error instanceof Error ? error.message : "Could not load charts.");
    } finally {
      loadingTopChartsRef.current = false;
    }
  }

  function maybeLoadMoreTopCharts(event: UIEvent<HTMLDivElement>) {
    const element = event.currentTarget;
    const remaining = element.scrollHeight - element.scrollTop - element.clientHeight;
    if (remaining < 220) {
      void loadMoreTopCharts();
    }
  }

  function maybeLoadMoreRecentPlays(event: UIEvent<HTMLDivElement>) {
    const element = event.currentTarget;
    const remaining = element.scrollHeight - element.scrollTop - element.clientHeight;
    if (remaining < 220) {
      void loadMoreRecentPlays();
    }
  }

  return (
    <>
      <div className={PANEL_CLASS}>
        <div className="grid gap-3 border-b border-[#e4e8dd] px-5 py-4 sm:flex sm:items-center sm:justify-between sm:gap-4">
          <div className="min-w-0">
            <h2 className="text-lg font-black text-[#171916]">Top tracked charts</h2>
            <p className="mt-1 text-sm font-medium text-[#66705e]">{topSort === "pumbility" ? "Pumbility contributors from PIU" : "Best scores from tracked charts"}</p>
          </div>
          <div className="flex items-center justify-between gap-2 sm:justify-end">
            <div className="grid grid-cols-2 border border-[#cdd5c5] bg-[#eef1e8] p-1">
              <SortButton active={topSort === "pumbility"} label="Pumbility" onClick={() => void changeTopSort("pumbility")} />
              <SortButton active={topSort === "score"} label="Score" onClick={() => void changeTopSort("score")} />
            </div>
            <BarChart3 aria-hidden="true" className="text-[#28c950]" size={22} />
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto" onScroll={maybeLoadMoreTopCharts}>
          <div className="divide-y divide-[#edf0e8] sm:hidden">
            {visibleTopCharts.length > 0 ? (
              visibleTopCharts.map((chart) => (
                <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-4 px-5 py-4" key={chart.chartToken}>
                  <SongCell mode={chart.mode} level={chart.level} song={chart.song} title={chart.songName} onOpen={() => chart.song && openNotebook(chart.song, chartTokenFor(chart))} />
                  <div className="min-w-[7.25rem] text-left">
                    <div className="flex items-baseline justify-between gap-2">
                      <p className="font-mono text-sm font-black text-[#171916]">{formatNumber(chart.bestScore)}</p>
                      <p className="text-xs font-black text-[#66705e]">{formatPerformanceGrade(chart.bestGrade ?? chart.bestPlate)}</p>
                    </div>
                    {topSort === "pumbility" ? <p className="mt-1 font-mono text-xs font-black text-[#66705e]">{formatNumber(chart.topPumbilityScore)} PP</p> : null}
                  </div>
                </div>
              ))
            ) : (
              <p className="px-5 py-10 text-sm font-bold text-[#66705e]">No tracked chart scores yet.</p>
            )}
          </div>
          <table className="hidden w-full table-fixed border-collapse text-left sm:table">
            <colgroup>
              <col className="w-[64%]" />
              <col className="w-[24%]" />
              <col className="w-[12%]" />
            </colgroup>
            <thead className="sticky top-0 z-10 bg-[#f2f4ed] text-xs font-black uppercase tracking-[0.08em] text-[#66705e]">
              <tr>
                <th className="px-4 py-3">Chart</th>
                <th className="px-4 py-3">Score</th>
                <th className="px-4 py-3">Grade</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#edf0e8]">
              {visibleTopCharts.length > 0 ? (
                visibleTopCharts.map((chart) => (
                  <tr key={chart.chartToken}>
                    <td className="px-4 py-4">
                      <SongCell mode={chart.mode} level={chart.level} song={chart.song} title={chart.songName} onOpen={() => chart.song && openNotebook(chart.song, chartTokenFor(chart))} />
                    </td>
                    <td className="align-middle px-4 py-4 text-left">
                      <p className="font-mono text-sm font-black text-[#171916]">{formatNumber(chart.bestScore)}</p>
                      {topSort === "pumbility" ? <p className="mt-1 font-mono text-xs font-black text-[#66705e]">{formatNumber(chart.topPumbilityScore)} PP</p> : null}
                    </td>
                    <td className="align-middle whitespace-nowrap px-4 py-4 text-left text-sm font-black text-[#171916]">{formatPerformanceGrade(chart.bestGrade ?? chart.bestPlate)}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td className="px-4 py-10 text-sm font-bold text-[#66705e]" colSpan={3}>
                    No tracked chart scores yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          {visibleTopCharts.length > 0 ? (
            <div className="border-t border-[#edf0e8] px-5 py-3 text-center text-xs font-black uppercase tracking-[0.12em] text-[#66705e]">
              {topStatus === "Loading"
                ? "Loading more"
                : topStatus
                  ? topStatus
                  : `${visibleTopCharts.length} of ${topTotal} loaded`}
            </div>
          ) : null}
        </div>
      </div>

      <div className={PANEL_CLASS}>
        <div className="flex items-center justify-between gap-4 border-b border-[#e4e8dd] px-5 py-4">
          <div>
            <h2 className="flex items-center gap-2 text-lg font-black text-[#171916]">
              <span>Recent plays</span>
              {pageRefreshState === "syncing" ? (
                <span
                  aria-label="Fetching recent plays"
                  className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-[#cdd5c5] bg-[#f7f8f2] text-[#157bda]"
                  title="Fetching recent plays"
                >
                  <RefreshCw aria-hidden="true" className="animate-spin" size={13} />
                </span>
              ) : null}
            </h2>
            <p className="mt-1 text-sm font-medium text-[#66705e]">{formatLastFetched(lastFetchedAt, recentArcade)}</p>
          </div>
          <Clock3 aria-hidden="true" className="text-[#157bda]" size={22} />
        </div>
        <div className="min-h-0 flex-1 divide-y divide-[#edf0e8] overflow-y-auto" onScroll={maybeLoadMoreRecentPlays}>
          {visibleRecentPlays.length > 0 ? (
            visibleRecentPlays.map((play) => (
              <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-4 px-5 py-4" key={`${play.chartToken}-${play.playedAt ?? play.score ?? "play"}`}>
                <SongCell mode={play.mode} level={play.level} playedAt={play.playedAt} song={play.song} title={play.songName} onOpen={() => play.song && openNotebook(play.song, chartTokenFor(play))} />
                <div className="text-right">
                  <p className={`font-mono text-sm font-black ${isFailedPerformanceGrade(play.grade) ? "text-[#7a8471]" : "text-[#171916]"}`}>{formatNumber(play.score)}</p>
                  <p className={`mt-1 text-xs ${isFailedPerformanceGrade(play.grade) ? "font-medium text-[#7a8471] line-through" : "font-black text-[#171916]"}`}>{formatPerformanceGrade(play.grade ?? play.plate)}</p>
                </div>
              </div>
            ))
          ) : (
            <p className="px-5 py-10 text-sm font-bold text-[#66705e]">No recent play snapshots yet.</p>
          )}
          {visibleRecentPlays.length > 0 ? (
            <div className="px-5 py-3 text-center text-xs font-black uppercase tracking-[0.12em] text-[#66705e]">
              {recentStatus === "Loading"
                ? "Loading more"
                : recentStatus
                  ? recentStatus
                  : nextRecentOffset === null
                  ? `${visibleRecentPlays.length} of ${recentTotal} loaded`
                  : `${visibleRecentPlays.length} of ${recentTotal} loaded`}
            </div>
          ) : null}
        </div>
      </div>

      <SongNotebook
        copied={openSong ? copiedSongSlug === openSong.slug : false}
        communityState={openSong && openSongCommunity?.slug === openSong.slug ? openSongCommunity.state : null}
        communityUser={communityUser}
        catalogVersion={performanceVersion}
        performanceVersion={performanceVersion}
        previewVolume={previewVolume}
        selectedChartToken={openChartToken}
        song={openSong}
        onClose={closeNotebook}
        onCopy={copySongLink}
      />
    </>
  );
}

async function fetchTopCharts(args: { offset: number; sort: TopChartsSort }): Promise<TopChartsResponse> {
  const response = await fetch(
    `/api/performance/top-charts?${new URLSearchParams({ offset: String(args.offset), limit: "35", sort: args.sort }).toString()}`,
    { cache: "no-store" },
  );
  const body = (await response.json().catch(() => null)) as TopChartsResponse | null;
  if (!response.ok || !body) {
    throw new Error(body?.error ?? "Could not load charts.");
  }

  return body;
}

function SortButton({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button
      aria-pressed={active}
      className={`inline-flex h-8 items-center justify-center gap-1.5 px-3 text-xs font-black transition ${
        active ? "bg-white text-[#171916] shadow-[0_1px_4px_rgba(29,35,24,0.10)]" : "text-[#66705e] hover:text-[#171916]"
      }`}
      type="button"
      onClick={onClick}
    >
      <ArrowDownWideNarrow aria-hidden="true" size={13} />
      {label}
    </button>
  );
}

function appendUniqueTopCharts(current: TopChartRow[], incoming: TopChartRow[]): TopChartRow[] {
  const seen = new Set(current.map((chart) => chart.chartToken));
  const next = [...current];
  for (const chart of incoming) {
    if (!seen.has(chart.chartToken)) {
      next.push(chart);
      seen.add(chart.chartToken);
    }
  }
  return next;
}

function appendUniqueRecentPlays(current: RecentPlayRow[], incoming: RecentPlayRow[]): RecentPlayRow[] {
  const seen = new Set(current.map(recentPlayKey));
  const next = [...current];
  for (const play of incoming) {
    const key = recentPlayKey(play);
    if (!seen.has(key)) {
      next.push(play);
      seen.add(key);
    }
  }
  return next;
}

function recentPlayKey(play: RecentPlayRow): string {
  return [play.chartToken, play.playedAt ?? "", play.score ?? "", play.grade ?? "", play.plate ?? ""].join("|");
}

function SongCell({
  level,
  mode,
  onOpen,
  playedAt,
  song,
  title,
}: {
  level: string | null;
  mode: string | null;
  onOpen: () => void;
  playedAt?: string | null;
  song: PublicSong | null;
  title: string;
}) {
  const content = (
    <>
      <span className="relative flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden border border-[#d9ded2] bg-[#eef1e8] text-[#66705e]">
        {song?.imageUrl ? (
          <Image alt="" className="object-cover" fill quality={92} sizes="48px" src={song.imageUrl} />
        ) : (
          <ImageIcon aria-hidden="true" size={17} />
        )}
      </span>
      <span className="min-w-0">
        <span className="block whitespace-normal break-words text-sm font-black leading-5 text-[#171916]">{title}</span>
        <span className="mt-1 block text-xs font-bold text-[#66705e]">
          {formatChartToken(mode, level)}
          {playedAt ? ` / ${formatDate(playedAt)}` : ""}
        </span>
      </span>
    </>
  );

  if (!song) {
    return <div className="flex min-w-0 items-center gap-3">{content}</div>;
  }

  return (
    <button className="flex min-w-0 items-center gap-3 text-left hover:text-[#28c950]" onClick={onOpen} type="button">
      {content}
    </button>
  );
}

function SongNotebook({
  copied,
  communityState,
  communityUser,
  catalogVersion,
  performanceVersion,
  previewVolume,
  selectedChartToken,
  song,
  onClose,
  onCopy,
}: {
  copied: boolean;
  communityState: SongCommunityState | null;
  communityUser: PublicUser | null;
  catalogVersion: PiuCatalogVersion;
  performanceVersion: PiuCatalogVersion;
  previewVolume: number;
  selectedChartToken: string | null;
  song: PublicSong | null;
  onClose: () => void;
  onCopy: (song: PublicSong, chartToken?: string | null) => void;
}) {
  return (
    <AnimatePresence>
      {song ? (
        <motion.div
          animate={{ opacity: 1 }}
          aria-label={`${song.title} details`}
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#171916]/45 px-3 py-5 backdrop-blur-sm sm:px-6"
          exit={{ opacity: 0 }}
          initial={{ opacity: 0 }}
          role="dialog"
          transition={{ duration: 0.18 }}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              onClose();
            }
          }}
        >
          <motion.div
            animate={{ opacity: 1, y: 0, scale: 1, rotate: 0 }}
            className="notebook-modal relative flex h-[min(92vh,880px)] w-[min(94vw,1180px)] flex-col overflow-hidden rounded-2xl border border-[#d6ddcf] bg-[#fbfcf7] shadow-[0_30px_90px_rgba(12,18,10,0.32)]"
            exit={{ opacity: 0, y: 18, scale: 0.97 }}
            initial={{ opacity: 0, y: 24, scale: 0.96, rotate: -0.4 }}
            transition={{ type: "spring", stiffness: 260, damping: 28 }}
          >
            <div className="absolute right-7 top-8 z-20 flex shrink-0 items-center gap-2">
              <a
                aria-label="Open full song page"
                className="notebook-action inline-flex size-10 items-center justify-center border border-[#cfd7c8] bg-white/90 text-[#343b30] shadow-[0_8px_22px_rgba(30,34,26,0.10)] backdrop-blur transition hover:bg-[#eef1e8]"
                href={songDetailHref(song, performanceVersion, selectedChartToken)}
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
                community={{ user: communityUser, initialState: communityState ?? EMPTY_COMMUNITY_STATE }}
                communityReadOnly
                allowScoreLinkPost
                initialSelectedChartToken={selectedChartToken}
                mode="notebook"
                performanceVersion={performanceVersion}
                catalogVersion={catalogVersion}
                previewVolume={previewVolume}
                song={song}
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

function chartTokenFor(play: { mode: string | null; level: string | null }): string | null {
  const mode = chartModeToken(play.mode);
  const level = chartLevelToken(play.level);
  return mode && level ? `${mode}${level}` : null;
}

function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined) {
    return "-";
  }

  return new Intl.NumberFormat("en-US").format(value);
}

function formatDate(value: string | null): string {
  const parsed = piuTimestampToDate(value);
  if (!parsed) {
    return value ?? "Pending";
  }

  return formatStableDateTime(parsed);
}

function formatLastFetched(value: string | null | undefined, fallback: string | null | undefined): string {
  const parsed = piuTimestampToDate(value);
  if (parsed) {
    return `Last fetched: ${formatStableDateTime(parsed)}`;
  }

  return fallback ? `Last fetched: ${fallback}` : "Last fetched: Pending";
}

function formatStableDateTime(value: Date): string {
  const month = new Intl.DateTimeFormat("en-US", { month: "short" }).format(value);
  const day = new Intl.DateTimeFormat("en-US", { day: "numeric" }).format(value);
  const time = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
  }).format(value);

  return `${month} ${day}, ${time}`;
}

function formatChartToken(mode: string | null, level: string | null): string {
  const token = chartTokenFor({ mode, level });
  if (!token) {
    return "Mode";
  }

  return token;
}

function chartModeToken(mode: string | null): string | null {
  const normalized = mode?.replace(/[^a-z]/gi, "").toLowerCase() ?? "";
  if (!normalized) {
    return null;
  }

  if (normalized === "s" || normalized === "single" || normalized === "singles") {
    return "S";
  }

  if (normalized === "d" || normalized === "double" || normalized === "doubles") {
    return "D";
  }

  if (normalized === "c" || normalized === "coop" || normalized === "cooperative") {
    return "C";
  }

  return mode?.toUpperCase() ?? null;
}

function chartLevelToken(level: string | null): string | null {
  const normalized = level?.replace(/[^0-9+]/g, "") ?? "";
  return normalized || null;
}

function songDetailHref(song: PublicSong, version: PiuCatalogVersion, chartToken: string | null = null): string {
  const params = new URLSearchParams({ version });
  if (chartToken) params.set("chart", chartToken);
  return `/songs/${song.slug}?${params.toString()}`;
}
