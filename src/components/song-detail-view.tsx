"use client";

import { Activity, ArrowLeft, Crown, Disc3, Folder, History, LoaderCircle, Maximize2, Minimize2, Music, Music2, Plus, Star, Tag } from "lucide-react";
import { MotionConfig, motion, useScroll, useSpring, useTransform } from "motion/react";
import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from "react";

import { CatalogAdminEditor } from "@/components/catalog-admin-editor";
import { SongCommunityPanel } from "@/components/song-community-panel";
import { SongPreviewPlayButton } from "@/components/song-preview-play-button";
import type { PublicUser, SongCommunityState } from "@/lib/auth";
import { piuSeriesMetadata } from "@/lib/catalog-version";
import { chartCommunityKey } from "@/lib/chart-community";
import { formatPerformanceGrade, isFailedPerformanceGrade } from "@/lib/performance-format";
import { displayedRecentPlayCount } from "@/lib/performance-play-count";
import { buildSongPerformanceCarousel } from "@/lib/song-performance-carousel";
import type { CommunityScoreLinkDraft } from "@/lib/community-score-link";
import type { PiuCatalogVersion, PiuSeriesId, PublicSong } from "@/lib/types";

interface SongDetailViewProps {
  song: PublicSong;
  community?: {
    user: PublicUser | null;
    initialState: SongCommunityState;
  };
  communityReadOnly?: boolean;
  allowScoreLinkPost?: boolean;
  initialSelectedChartToken?: string | null;
  previewVolume?: number;
  performanceVersion?: PiuCatalogVersion;
  catalogVersion?: PiuSeriesId;
  userIsAdmin?: boolean;
  mode?: "page" | "notebook";
  onBack?: () => void;
  onCatalogSaved?: (song: PublicSong) => void;
  onSelectedChartTokenChange?: (chartToken: string | null) => void;
}

interface SongChartPerformance {
  latestPlay: {
    id: string;
    score: number | null;
    grade: string | null;
    plate: string | null;
    playedAt: string | null;
    stageBreak: boolean;
    judgments: JudgmentCounts;
  } | null;
  history: Array<{
    id: string;
    score: number | null;
    grade: string | null;
    plate: string | null;
    playedAt: string | null;
    stageBreak: boolean;
    judgments: JudgmentCounts;
  }>;
  stats: {
    bestScore: number | null;
    previousBestScore: number | null;
    latestScore: number | null;
    latestStageBreak: boolean;
    latestPlayedAt: string | null;
    recentPlayCount: number;
    stageBreakCount: number;
    bestGrade: string | null;
    bestPlate: string | null;
    bestBucketPage: number | null;
    bestSyncedAt: string | null;
  } | null;
}

interface JudgmentCounts {
  perfect: number | null;
  great: number | null;
  good: number | null;
  bad: number | null;
  miss: number | null;
}

type PerformanceLoadState = "idle" | "loading" | "loaded" | "error";
type PerformanceTimeFormat = "datetime" | "weekday" | "relative";

const PERFORMANCE_TIME_FORMAT_STORAGE_KEY = "piugame.performance-time-format";

const sectionMotion = {
  initial: { opacity: 0, y: 14 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, margin: "-80px" },
  transition: { duration: 0.38, ease: [0.22, 1, 0.36, 1] },
} as const;

export function SongDetailView({ song, community, communityReadOnly = false, allowScoreLinkPost = false, initialSelectedChartToken = null, previewVolume, performanceVersion = song.version, catalogVersion = "phoenix2", userIsAdmin = false, mode = "page", onBack, onCatalogSaved, onSelectedChartTokenChange }: SongDetailViewProps) {
  const [currentSong, setCurrentSong] = useState(song);
  const [selectedChartToken, setSelectedChartToken] = useState<string | null>(
    initialSelectedChartToken && song.chartSummary.includes(initialSelectedChartToken) ? initialSelectedChartToken : song.chartSummary[0] ?? null,
  );
  const [favoriteSaved, setFavoriteSaved] = useState(community?.initialState.saved ?? false);
  const [favoriteSaving, setFavoriteSaving] = useState(false);
  const [compactView, setCompactView] = useState(community?.user?.preferences.songDetailCompactView ?? false);
  const [performanceState, setPerformanceState] = useState<PerformanceLoadState>("idle");
  const [performance, setPerformance] = useState<SongChartPerformance | null>(null);
  const [scoreLinkDraft, setScoreLinkDraft] = useState<CommunityScoreLinkDraft | null>(null);
  const performanceCacheRef = useRef(new Map<string, SongChartPerformance | null>());
  const { scrollY } = useScroll();
  const isNotebook = mode === "notebook";
  const canToggleCompact = !isNotebook;
  const isCompact = compactView && canToggleCompact;
  const imageWidth = useSpring(useTransform(scrollY, [0, 420], isCompact ? [128, 128] : [360, 281]), { stiffness: 180, damping: 28 });
  const imageColumnWidth = useTransform(imageWidth, (value) => `${value}px`);
  const imageShadow = useTransform(
    scrollY,
    [0, 420],
    ["0 18px 55px rgba(29,35,24,0.10)", "0 12px 36px rgba(29,35,24,0.14)"],
  );
  const imageRadius = useTransform(scrollY, [0, 420], ["0px", "10px"]);
  const canFavorite = Boolean(community?.user);
  const songPreviewVolume = previewVolume ?? community?.user?.preferences.songPreviewVolume ?? 0.5;
  const seriesLabel = (currentSong.series ?? "Unknown series").toUpperCase();
  const folderLabel = formatFolderLabel(currentSong);
  const bpmLabel = formatBpmLabel(currentSong.bpm);
  const selectedChartId = chartCommunityKey(currentSong, catalogVersion, selectedChartToken);

  function handleCatalogSaved(updatedSong: PublicSong) {
    setCurrentSong(updatedSong);
    if (!selectedChartToken || !updatedSong.chartSummary.includes(selectedChartToken)) {
      const nextChartToken = updatedSong.chartSummary[0] ?? null;
      setSelectedChartToken(nextChartToken);
      onSelectedChartTokenChange?.(nextChartToken);
    }
    onCatalogSaved?.(updatedSong);
  }

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    async function loadPerformance() {
      await Promise.resolve();
      if (cancelled) {
        return;
      }

      if (!selectedChartToken) {
        setPerformance(null);
        setPerformanceState("idle");
        return;
      }

      const cacheKey = `${currentSong.slug}:${currentSong.title}:${performanceVersion}:${selectedChartToken}`;
      const cachedPerformance = performanceCacheRef.current.get(cacheKey);
      if (cachedPerformance !== undefined) {
        setPerformance(cachedPerformance);
        setPerformanceState("loaded");
        return;
      }

      const params = new URLSearchParams({ chart: selectedChartToken, songName: currentSong.title, version: performanceVersion });
      setPerformanceState("loading");
      try {
        const response = await fetch(`/api/songs/${encodeURIComponent(currentSong.slug)}/performance?${params.toString()}`, { cache: "no-store", signal: controller.signal });
        if (!response.ok) {
          throw new Error("Performance lookup failed.");
        }
        const body = (await response.json()) as { performance?: SongChartPerformance | null };
        if (cancelled) {
          return;
        }
        const nextPerformance = body.performance ?? null;
        performanceCacheRef.current.set(cacheKey, nextPerformance);
        setPerformance(nextPerformance);
        setPerformanceState("loaded");
      } catch {
        if (!cancelled && !controller.signal.aborted) {
          setPerformance(null);
          setPerformanceState("error");
        }
      }
    }

    void loadPerformance();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [currentSong.slug, currentSong.title, performanceVersion, selectedChartToken]);

  const jacketImage = (
    <motion.div
      layout
      className={`song-detail-jacket relative aspect-square w-full overflow-hidden border border-[#d6ddcf] bg-white ${isCompact ? "shadow-[0_12px_32px_rgba(29,35,24,0.14)]" : isNotebook ? "" : "mx-auto max-w-[360px] origin-top-left"}`}
      style={
        isCompact
          ? { borderRadius: 8 }
          : {
              borderRadius: imageRadius,
              boxShadow: imageShadow,
            }
      }
      transition={{ type: "spring", stiffness: 260, damping: 30 }}
    >
      {currentSong.imageUrl ? (
        <Image alt={`${currentSong.title} jacket`} className="object-cover" fill priority sizes={isCompact ? "128px" : "360px"} src={currentSong.imageUrl} />
      ) : (
        <div className="flex h-full items-center justify-center font-bold text-[#66705f]">No jacket</div>
      )}
      <SongPreviewPlayButton previewUrl={currentSong.previewUrl} title={currentSong.title} volume={songPreviewVolume} />
    </motion.div>
  );
  const historySection = (
    <motion.section {...sectionMotion} className="mt-6 border-b border-[#d9ded2] pb-6">
      <div className="mb-3 flex items-center gap-2 text-sm font-black uppercase text-[#596153]">
        <History aria-hidden="true" size={17} />
        History
      </div>
      {currentSong.history.length > 0 ? (
        <div className="grid gap-3">
          {currentSong.history.map((event, index) => (
            <div key={`${event.date}:${event.type}:${event.version}:${index}`} className="border border-[#d8dfd1] bg-white px-3 py-2">
              <div className="flex flex-wrap items-center gap-2 text-xs font-black uppercase text-[#596153]">
                <span>{formatCatalogHistoryDate(event.date)}</span>
                <span>{event.type}</span>
                <span>{piuSeriesMetadata(event.version).label}</span>
              </div>
              <p className="mt-1 text-sm font-medium text-[#3d4638]">{event.note}</p>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm font-medium text-[#66705f]">No catalog history has been recorded for this song yet.</p>
      )}
      {selectedChartToken ? <ChartHistory history={currentSong.chartHistory.filter((event) => event.chartId === selectedChartId)} chartToken={selectedChartToken} /> : null}
    </motion.section>
  );

  async function toggleFavorite() {
    if (!community?.user) {
      return;
    }

    const nextSaved = !favoriteSaved;
    setFavoriteSaved(nextSaved);
    setFavoriteSaving(true);
    try {
      const response = await fetch(`/api/songs/${encodeURIComponent(currentSong.slug)}/community`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "save", saved: nextSaved }),
      });
      const body = (await response.json()) as { state?: SongCommunityState };
      if (response.ok && body.state) {
        setFavoriteSaved(body.state.saved);
      } else {
        setFavoriteSaved(!nextSaved);
      }
    } catch {
      setFavoriteSaved(!nextSaved);
    } finally {
      setFavoriteSaving(false);
    }
  }

  function toggleCompactView() {
    const nextCompactView = !compactView;
    setCompactView(nextCompactView);

    if (!community?.user) {
      return;
    }

    void fetch("/api/account/preferences", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ songDetailCompactView: nextCompactView }),
    });
  }

  return (
    <MotionConfig reducedMotion="user">
      <motion.section
        className={`song-detail-shell mx-auto grid max-w-6xl px-3 pb-4 pt-0 sm:px-8 sm:py-8 lg:px-10 ${isCompact ? "gap-6 lg:grid-cols-[var(--song-detail-art-width)_minmax(0,1fr)]" : `gap-8 ${isNotebook ? "pb-12 lg:grid-cols-[auto_minmax(0,1fr)]" : "lg:grid-cols-[var(--song-detail-art-width)_minmax(0,1fr)]"}`}`}
        layout
        style={!isNotebook ? ({ "--song-detail-art-width": imageColumnWidth } as CSSProperties) : undefined}
        transition={{ layout: { type: "spring", stiffness: 180, damping: 26, mass: 0.9 } }}
      >
        <motion.div className={`${isNotebook ? "hidden lg:block" : ""} lg:sticky lg:top-6 lg:self-start`} layout style={isNotebook ? { width: imageWidth } : undefined}>
          {onBack && !isNotebook ? (
            <button className="mb-5 inline-flex items-center gap-2 text-sm font-bold text-[#56604e] hover:text-[#28c950]" type="button" onClick={onBack}>
              <ArrowLeft aria-hidden="true" size={17} />
              Catalog
            </button>
          ) : !isNotebook ? (
            <Link className="mb-5 inline-flex items-center gap-2 text-sm font-bold text-[#56604e] hover:text-[#28c950]" href="/">
              <ArrowLeft aria-hidden="true" size={17} />
              Catalog
            </Link>
          ) : null}
          <div className="hidden lg:block">{jacketImage}</div>
        </motion.div>

      <motion.div className="min-w-0 pt-2! md:pt-12!" layout transition={{ layout: { type: "spring", stiffness: 180, damping: 26, mass: 0.9 } }}>
        <motion.div {...sectionMotion} className="mb-4 flex items-start justify-between gap-1.5 sm:gap-3">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5 sm:flex-nowrap sm:gap-2">
            <span aria-label={seriesLabel} className="song-detail-meta-chip inline-flex min-w-0 items-center justify-center gap-1.5 whitespace-nowrap border border-[#cdd5c5] bg-white px-2 py-1.5 text-[11px] font-black uppercase text-[#596153] sm:gap-2 sm:px-3 sm:text-sm" style={{ "--metadata-chip-grow": Math.max(seriesLabel.length, 8) } as CSSProperties}>
              <Disc3 aria-hidden="true" className="size-3.5 shrink-0 sm:size-4" />
              <span>{seriesLabel}</span>
            </span>
            <span aria-label={folderLabel} className="song-detail-meta-chip inline-flex min-w-0 items-center justify-center gap-1.5 whitespace-nowrap border border-[#cdd5c5] bg-white px-2 py-1.5 text-[11px] font-black uppercase text-[#596153] sm:gap-2 sm:px-3 sm:text-sm" style={{ "--metadata-chip-grow": Math.max(folderLabel.length, 8) } as CSSProperties}>
              <Folder aria-hidden="true" className="size-3.5 shrink-0 sm:size-4" />
              <span>{folderLabel}</span>
            </span>
            {bpmLabel ? (
              <span aria-label={bpmLabel} className="song-detail-meta-chip inline-flex min-w-0 items-center justify-center gap-1.5 whitespace-nowrap border border-[#cdd5c5] bg-white px-2 py-1.5 text-[11px] font-black uppercase text-[#596153] sm:gap-2 sm:px-3 sm:text-sm" style={{ "--metadata-chip-grow": Math.max(bpmLabel.length, 8) } as CSSProperties}>
                <Music aria-hidden="true" className="size-3.5 shrink-0 sm:size-4" />
                <span>{bpmLabel}</span>
              </span>
            ) : null}
            {currentSong.isPremium ? (
              <span aria-label="Premium song" className="inline-flex size-7 shrink-0 items-center justify-center border border-[#cdd5c5] bg-white text-[#9b6412] sm:size-[34px]" role="img" title="Premium song">
                <Crown aria-hidden="true" className="size-3.5 sm:size-4" />
              </span>
            ) : null}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <CatalogAdminEditor catalogVersion={catalogVersion} label="song details" song={currentSong} userIsAdmin={userIsAdmin} onSaved={handleCatalogSaved} />
            {canToggleCompact ? (
              <button
                aria-label={compactView ? "Show full screen view" : "Show small screen view"}
                aria-pressed={compactView}
                className="hidden h-10 w-10 items-center justify-center border border-[#cdd5c5] bg-white text-[#596153] transition hover:border-[#28c950] hover:text-[#28c950] sm:inline-flex"
                onClick={toggleCompactView}
                title={compactView ? "Full screen view" : "Small screen view"}
                type="button"
              >
                {compactView ? <Maximize2 aria-hidden="true" size={18} /> : <Minimize2 aria-hidden="true" size={18} />}
              </button>
            ) : null}
            {community && !isNotebook ? (
              canFavorite ? (
                <button
                  aria-label={favoriteSaved ? "Remove favorite" : "Favorite song"}
                  className={`inline-flex h-10 w-10 items-center justify-center border transition ${favoriteSaved ? "border-[#e2cd96] bg-[#fff4cf] text-[#ffca6d]" : "border-[#cdd5c5] bg-white text-[#596153] hover:border-[#28c950] hover:text-[#28c950]"} disabled:opacity-60`}
                  disabled={favoriteSaving}
                  onClick={toggleFavorite}
                  title={favoriteSaved ? "Remove favorite" : "Favorite song"}
                  type="button"
                >
                  <Star aria-hidden="true" fill={favoriteSaved ? "currentColor" : "none"} size={19} />
                </button>
              ) : (
                <Link
                  aria-label="Sign in to favorite"
                  className="inline-flex h-10 w-10 items-center justify-center border border-[#cdd5c5] bg-white text-[#596153] transition hover:border-[#28c950] hover:text-[#28c950]"
                  href={`/api/auth/google/login?next=/songs/${currentSong.slug}`}
                  title="Sign in to favorite"
                >
                  <Star aria-hidden="true" size={19} />
                </Link>
              )
            ) : null}
          </div>
        </motion.div>
        <motion.div
          className="flex items-start gap-3"
          layout
          initial={{ opacity: 0, y: 20, filter: "blur(8px)" }}
          animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
          transition={{ duration: 0.48, ease: [0.22, 1, 0.36, 1] }}
        >
          <div className="w-28 shrink-0 lg:hidden">{jacketImage}</div>
          <motion.div className="min-w-0 flex-1" layout transition={{ type: "spring", stiffness: 190, damping: 28, mass: 0.9 }}>
            <motion.div className="flex items-start gap-3" layout transition={{ type: "spring", stiffness: 190, damping: 28, mass: 0.9 }}>
              <motion.h1 className="min-w-0 break-words text-[28px] font-black leading-none tracking-normal text-[#11130f] sm:text-7xl" layout>
                {currentSong.title}
              </motion.h1>
            </motion.div>
            <motion.p
              className="mt-4 text-2xl font-bold text-[#4f5849]"
              layout
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.08, duration: 0.38, ease: [0.22, 1, 0.36, 1] }}
            >
              {currentSong.artist}
            </motion.p>
          </motion.div>
        </motion.div>

        <motion.section {...sectionMotion} className="mt-8 border-y border-[#d9ded2] py-6">
          <div className="mb-3 flex items-center gap-2 text-sm font-black uppercase text-[#596153]">
            <Music2 aria-hidden="true" size={17} />
            Charts
          </div>
          <div className="flex flex-wrap gap-2">
            {currentSong.chartSummary.length > 0 ? (
              currentSong.chartSummary.map((chart) => (
                <motion.button
                  key={chart}
                  className={`border px-3 py-1.5 text-sm font-black transition ${selectedChartToken === chart ? "border-[#171916] bg-[#171916] text-white shadow-[0_10px_24px_rgba(29,35,24,0.14)]" : "border-[#d8dfd1] bg-white text-[#3d4638] hover:border-[#28c950] hover:text-[#28c950]"}`}
                  onClick={() => {
                    setSelectedChartToken(chart);
                    onSelectedChartTokenChange?.(chart);
                  }}
                  type="button"
                  whileHover={{ y: -2, scale: 1.04 }}
                  transition={{ type: "spring", stiffness: 360, damping: 26 }}
                >
                  {chart}
                </motion.button>
              ))
            ) : (
              <p className="text-sm font-medium text-[#66705f]">Chart metadata is ready to appear here once available.</p>
            )}
          </div>
        </motion.section>

        <SongPerformanceSection
          key={`${selectedChartToken ?? "none"}:${performance?.latestPlay?.playedAt ?? ""}:${performance?.stats?.bestScore ?? ""}`}
          chartToken={selectedChartToken}
          performance={performance}
          state={performanceState}
          performanceVersion={performanceVersion}
          onCreateScoreLink={setScoreLinkDraft}
        />

        {community ? (
          <SongCommunityPanel
            key={`${currentSong.slug}:${community.initialState.posts.length}:${community.initialState.communityTags.length}:${community.initialState.tagVotes.length}:${community.initialState.note.length}`}
            afterCommunity={historySection}
            initialState={community.initialState}
            readOnly={communityReadOnly}
            allowScoreLinkPost={allowScoreLinkPost}
            initialChartToken={communityReadOnly ? null : selectedChartToken}
            catalogVersion={catalogVersion}
            selectedChartToken={selectedChartToken}
            scoreLinkDraft={scoreLinkDraft}
            onScoreLinkDismiss={() => setScoreLinkDraft(null)}
            song={currentSong}
            user={community.user}
          />
        ) : (
          <motion.section {...sectionMotion} className="mt-6 border-b border-[#d9ded2] pb-6">
            <div className="mb-3 flex items-center gap-2 text-sm font-black uppercase text-[#596153]">
              <Tag aria-hidden="true" size={17} />
              Tags
            </div>
            <div className="flex flex-wrap gap-2">
              {currentSong.tags.length > 0 ? (
                currentSong.tags.map((tag) => (
                  <span key={tag} className="border border-[#d8dfd1] bg-white px-3 py-1.5 text-sm font-bold text-[#3d4638]">
                    {tag}
                  </span>
                ))
              ) : (
                <p className="text-sm font-medium text-[#66705f]">No tags have been added for this song yet.</p>
              )}
            </div>
          </motion.section>
        )}

        {!community ? historySection : null}

      </motion.div>
      </motion.section>
    </MotionConfig>
  );
}

function ChartHistory({ chartToken, history }: { chartToken: string; history: PublicSong["chartHistory"] }) {
  return (
    <div className="mt-4 border-t border-[#d8dfd1] pt-4">
      <p className="text-xs font-black uppercase text-[#596153]">{chartToken} chart history</p>
      {history.length > 0 ? (
        <div className="mt-2 grid gap-2">
          {history.map((event) => (
            <div key={event.id} className="border border-[#d8dfd1] bg-white px-3 py-2 text-sm font-medium text-[#3d4638]">
              <span className="mr-2 text-xs font-black uppercase text-[#596153]">{formatCatalogHistoryDate(event.date)} · {event.type}</span>
              {event.note}
            </div>
          ))}
        </div>
      ) : <p className="mt-2 text-sm font-medium text-[#66705f]">No chart-specific history has been recorded.</p>}
    </div>
  );
}

function SongPerformanceSection(props: { chartToken: string | null; performance: SongChartPerformance | null; state: PerformanceLoadState; performanceVersion: "phoenix" | "phoenix2"; onCreateScoreLink: (draft: CommunityScoreLinkDraft) => void }) {
  const latestPlay = props.performance?.latestPlay ?? null;
  const stats = props.performance?.stats ?? null;
  const scoreChange = stats?.bestScore !== null && stats?.bestScore !== undefined && stats.previousBestScore !== null && stats.previousBestScore !== undefined ? stats.bestScore - stats.previousBestScore : null;
  const carousel = buildSongPerformanceCarousel({
    bestGrade: stats?.bestGrade ?? null,
    bestPlate: stats?.bestPlate ?? null,
    bestScore: stats?.bestScore ?? null,
    history: props.performance?.history ?? [],
    latestPlay,
  });
  const [carouselIndex, setCarouselIndex] = useState(0);
  const savedTimeFormat = useSyncExternalStore(subscribeToTimeFormat, readPerformanceTimeFormat, serverTimeFormat);
  const [selectedTimeFormat, setSelectedTimeFormat] = useState<PerformanceTimeFormat | null>(null);
  const timeFormat = selectedTimeFormat ?? savedTimeFormat;

  function changeTimeFormat(nextFormat: PerformanceTimeFormat) {
    setSelectedTimeFormat(nextFormat);
    try {
      window.localStorage.setItem(PERFORMANCE_TIME_FORMAT_STORAGE_KEY, nextFormat);
    } catch {
      // Keep the current session's choice when browser storage is unavailable.
    }
  }

  const selectedIndex = Math.min(carouselIndex, Math.max(carousel.entries.length - 1, 0));
  const selectedPlay = carousel.entries[selectedIndex] ?? null;
  const judgments = judgmentEntries(selectedPlay?.judgments);
  const visibleAttempts = carousel.entries.slice(selectedIndex, selectedIndex + 3);
  const newerAttempt = selectedIndex > 0 ? carousel.entries[selectedIndex - 1] : null;
  const selectedLabel =
    selectedIndex > 0
      ? "Previous attempt"
      : carousel.primaryKind === "best"
        ? "Best score"
        : "Latest attempt";

  return (
    <motion.section {...sectionMotion} className="mt-6 border-b border-[#d9ded2] pb-6">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm font-black uppercase text-[#596153]">
          <Activity aria-hidden="true" size={17} />
          Performance
        </div>
        {props.state === "loading" ? (
          <LoaderCircle aria-hidden="true" className="animate-spin text-[#28c950]" size={17} />
        ) : null}
      </div>

      {props.state === "error" ? (
        <motion.p key="error" {...performanceBodyMotion} className="text-sm font-medium text-[#66705f]">
          Performance could not be loaded right now.
        </motion.p>
      ) : props.state === "loading" && !latestPlay && !stats ? (
        <motion.p key={`loading:${props.chartToken ?? "none"}`} {...performanceBodyMotion} className="text-sm font-medium text-[#66705f]">
          Loading performance...
        </motion.p>
      ) : !selectedPlay && !stats ? (
        <motion.p key={`empty:${props.chartToken ?? "none"}`} {...performanceBodyMotion} className="text-sm font-medium text-[#66705f]">
          {props.chartToken ? `No tracked plays for ${props.chartToken} yet.` : "Choose a chart to view performance."}
        </motion.p>
      ) : (
        <motion.div
          key={`ready:${props.chartToken ?? "none"}`}
          {...performanceBodyMotion}
          animate={{ opacity: props.state === "loading" ? 0.56 : 1, y: 0 }}
          aria-busy={props.state === "loading"}
        >
          <div className="flex flex-wrap items-start gap-5">
            {selectedPlay ? (
              <div className="relative h-24 w-[22rem] shrink-0">
                {newerAttempt ? (
                  <motion.div
                    className="absolute left-0 top-0 w-64 text-left"
                    key={`newer:${newerAttempt.playedAt ?? "unknown"}:${newerAttempt.score ?? "none"}`}
                    onClick={() => setCarouselIndex((current) => Math.max(current - 1, 0))}
                    title="Show later attempt"
                    animate={{ opacity: 0.9, scale: 0.975, x: 0, y: 0 }}
                    style={{ zIndex: 1 }}
                    transition={{ type: "spring", stiffness: 300, damping: 28 }}
                  >
                    <button
                      aria-label={`Show later attempt: ${newerAttempt.stageBreak ? "Stage Break" : formatScore(newerAttempt.score)}`}
                      className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-30 focus:bg-white focus:px-2 focus:py-1 focus:text-xs focus:font-bold focus:text-[#171916] focus:outline-none focus:ring-2 focus:ring-[#28c950]"
                      onClick={(event) => {
                        event.stopPropagation();
                        setCarouselIndex((current) => Math.max(current - 1, 0));
                      }}
                      type="button"
                    >
                      Show later attempt
                    </button>
                    <PerformanceScoreCard
                      date={newerAttempt.playedAt}
                      grade={newerAttempt.grade ?? newerAttempt.plate}
                      label="Later attempt"
                      muted={(newerAttempt.stageBreak || isFailedChartGrade(newerAttempt.grade)) && !newerAttempt.stageBreak}
                      score={newerAttempt.stageBreak ? "Stage break" : formatScore(newerAttempt.score)}
                      stageBreak={newerAttempt.stageBreak}
                      rawScore={newerAttempt.score}
                      plate={newerAttempt.plate}
                      judgments={newerAttempt.judgments}
                      performancePlayId={newerAttempt.id}
                      performanceVersion={props.performanceVersion}
                      onCreateScoreLink={props.onCreateScoreLink}
                      onToggleTimeFormat={() => changeTimeFormat(nextPerformanceTimeFormat(timeFormat))}
                      timeFormat={timeFormat}
                    />
                  </motion.div>
                ) : null}
                {visibleAttempts.map((play, offset) => {
                  const stackPosition = offset;
                  const isCurrent = offset === 0;
                  const playFailed = play.stageBreak || isFailedChartGrade(play.grade);
                  const currentOffset = newerAttempt ? 28 : 0;
                  return (
                    <motion.div
                      aria-label={isCurrent ? "Current performance attempt" : `Show previous attempt: ${play.stageBreak ? "Stage Break" : formatScore(play.score)}`}
                      className={`absolute left-0 top-0 w-64 text-left ${offset === 1 ? "cursor-pointer" : offset > 1 ? "pointer-events-none" : ""}`}
                      key={`${play.playedAt ?? "unknown"}:${play.score ?? "none"}:${offset}`}
                      onClick={() => {
                        if (offset === 1) {
                          setCarouselIndex((current) => Math.min(current + 1, carousel.entries.length - 1));
                        }
                      }}
                      onKeyDown={(event) => {
                        if (offset === 1 && (event.key === "Enter" || event.key === " ")) {
                          event.preventDefault();
                          setCarouselIndex((current) => Math.min(current + 1, carousel.entries.length - 1));
                        }
                      }}
                      role={offset === 1 ? "button" : undefined}
                      tabIndex={offset === 1 ? 0 : undefined}
                      title={isCurrent ? undefined : offset === 1 ? "Show previous attempt" : undefined}
                      animate={{ opacity: 1 - stackPosition * 0.08, scale: 1 - stackPosition * 0.025, x: currentOffset + stackPosition * 18, y: 0 }}
                      style={{ zIndex: 10 - offset }}
                      transition={{ type: "spring", stiffness: 300, damping: 28 }}
                    >
                      <PerformanceScoreCard
                        date={play.playedAt}
                        grade={play.grade ?? play.plate}
                        label={isCurrent ? selectedLabel : "Previous attempt"}
                        muted={playFailed && !play.stageBreak}
                        playCount={isCurrent && selectedIndex === 0 ? formatPlayCount(displayedRecentPlayCount(stats)) : undefined}
                        score={play.stageBreak ? "Stage break" : formatScore(play.score)}
                        stageBreak={play.stageBreak}
                        rawScore={play.score}
                        plate={play.plate}
                        judgments={play.judgments}
                        performancePlayId={play.id}
                        performanceVersion={props.performanceVersion}
                        onCreateScoreLink={props.onCreateScoreLink}
                        onToggleTimeFormat={() => changeTimeFormat(nextPerformanceTimeFormat(timeFormat))}
                        timeFormat={timeFormat}
                      />
                    </motion.div>
                  );
                })}
              </div>
            ) : null}
            {scoreChange !== null || judgments.length > 0 ? (
              <div className="flex min-w-0 basis-full flex-1 items-end gap-6 border-t border-[#d9ded2] pt-4 sm:min-w-[18rem] sm:basis-0 sm:border-l sm:border-t-0 sm:pl-6 sm:pt-0">
                {scoreChange !== null ? (
                  <div>
                    <p className="text-xs font-black uppercase tracking-[0.14em] text-[#7a8471]">Delta</p>
                    <p className={`mt-1 font-mono text-lg font-black ${scoreChange >= 0 ? "text-[#1f7a43]" : "text-[#9b2b1f]"}`}>
                      {scoreChange >= 0 ? "+" : ""}
                      {formatScore(scoreChange)}
                    </p>
                  </div>
                ) : null}
                {judgments.length > 0 ? (
                  <div className="grid grid-cols-5 gap-2">
                    {judgments.map((judgment, index) => (
                      <div key={`${judgment.label}:${index}`} className="min-w-10 text-right">
                        <p className="text-[11px] font-black uppercase text-[#7a8471]">{judgment.label}</p>
                        <p className="mt-1 font-mono text-sm font-black text-[#171916]">{formatScore(judgment.value)}</p>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        </motion.div>
      )}
    </motion.section>
  );
}

function PerformanceScoreCard({
  date,
  grade,
  label,
  muted = false,
  playCount,
  score,
  stageBreak = false,
  rawScore,
  plate,
  judgments,
  performancePlayId,
  performanceVersion,
  onCreateScoreLink,
  onToggleTimeFormat,
  timeFormat,
}: {
  date: string | null;
  grade: string | null;
  label: string;
  muted?: boolean;
  playCount?: string;
  score: string;
  stageBreak?: boolean;
  rawScore: number | null;
  plate: string | null;
  judgments: JudgmentCounts | null;
  performancePlayId?: string;
  performanceVersion: "phoenix" | "phoenix2";
  onCreateScoreLink: (draft: CommunityScoreLinkDraft) => void;
  onToggleTimeFormat: () => void;
  timeFormat: PerformanceTimeFormat;
}) {
  return (
    <div className="relative border border-[#d8dfd1] bg-white px-4 py-3 shadow-[0_6px_18px_rgba(30,34,26,0.05)]">
      <button
        aria-label="Link this score in a community post"
        className="absolute right-2 top-2 inline-flex size-6 items-center justify-center border border-[#d8dfd1] bg-white text-[#596153] hover:border-[#28c950] hover:text-[#28c950] disabled:cursor-not-allowed disabled:opacity-40"
        disabled={!performancePlayId}
        onClick={(event) => {
          event.stopPropagation();
          if (performancePlayId) {
            onCreateScoreLink({ performancePlayId, piuVersion: performanceVersion, score: rawScore, grade, plate, stageBreak, judgments });
          }
        }}
        title={performancePlayId ? "Post this score to community" : "Only recorded performance attempts can be posted"}
        type="button"
      >
        <Plus aria-hidden="true" size={14} />
      </button>
      <p className="text-xs font-black uppercase tracking-[0.14em] text-[#7a8471]">{label}</p>
      {stageBreak ? (
        <>
          <p className="mt-1 text-[1.7rem] font-black leading-none tracking-tight text-[#7a8471]">Stage Break</p>
          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs font-bold text-[#66705f]">
            {playCount ? <span>{playCount}</span> : null}
            {date ? <span>{formatPlayDate(date, timeFormat)}</span> : null}
          </div>
        </>
      ) : (
        <div className="mt-1 grid grid-cols-[max-content_minmax(0,1fr)] items-baseline gap-x-3 gap-y-1">
          <p className={`text-[1.7rem] font-black leading-none tracking-tight ${muted ? "text-[#7a8471] line-through decoration-2" : "text-[#171916]"}`}>{formatPerformanceGrade(grade)}</p>
          <p className={`col-start-2 text-base font-black leading-none tracking-tight ${muted ? "text-[#7a8471] line-through decoration-2" : "text-[#171916]"}`}>{score}</p>
          {playCount ? <span className="text-xs font-bold text-[#66705f]">{playCount}</span> : null}
          {date ? (
            <span
              aria-label={`Switch to ${performanceTimeFormatLabel(nextPerformanceTimeFormat(timeFormat))}`}
              className="col-start-2 cursor-pointer text-xs font-bold text-[#66705f]"
              onClick={(event) => {
                event.stopPropagation();
                onToggleTimeFormat();
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  event.stopPropagation();
                  onToggleTimeFormat();
                }
              }}
              role="button"
              tabIndex={0}
              title="Click to switch time format"
            >
              {formatPlayDate(date, timeFormat)}
            </span>
          ) : null}
        </div>
      )}
    </div>
  );
}

function isFailedChartGrade(grade: string | null | undefined): boolean {
  return isFailedPerformanceGrade(grade);
}

const performanceBodyMotion = {
  initial: { opacity: 0, y: 5, scale: 0.99 },
  animate: { opacity: 1, y: 0, scale: 1 },
  exit: { opacity: 0, y: -3, scale: 0.995 },
  transition: { duration: 0.16, ease: [0.22, 1, 0.36, 1] },
} as const;

function formatScore(value: number | null | undefined): string {
  if (value === null || value === undefined) {
    return "-";
  }

  return new Intl.NumberFormat("en-US").format(value);
}

function formatPlayCount(value: number | null | undefined): string {
  if (!value) {
    return "0 plays";
  }

  return `${new Intl.NumberFormat("en-US").format(value)} ${value === 1 ? "play" : "plays"}`;
}

function judgmentEntries(judgments: JudgmentCounts | null | undefined): Array<{ label: string; value: number }> {
  if (!judgments) {
    return [];
  }

  return [
    { label: "P", value: judgments.perfect },
    { label: "G", value: judgments.great },
    { label: "G", value: judgments.good },
    { label: "B", value: judgments.bad },
    { label: "M", value: judgments.miss },
  ].filter((judgment): judgment is { label: string; value: number } => typeof judgment.value === "number");
}

function readPerformanceTimeFormat(): PerformanceTimeFormat {
  if (typeof window === "undefined") {
    return "datetime";
  }

  try {
    const storedFormat = window.localStorage.getItem(PERFORMANCE_TIME_FORMAT_STORAGE_KEY);
    return storedFormat === "weekday" || storedFormat === "relative" ? storedFormat : "datetime";
  } catch {
    return "datetime";
  }
}

function subscribeToTimeFormat(): () => void {
  return () => undefined;
}

function serverTimeFormat(): PerformanceTimeFormat {
  return "datetime";
}

function formatPlayDate(value: string | null, timeFormat: PerformanceTimeFormat): string {
  if (!value) {
    return "No timestamp";
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "No timestamp";
  }

  if (!isWithinPastWeek(parsed)) {
    return formatStableDateTime(parsed);
  }

  if (timeFormat === "weekday") {
    return `${new Intl.DateTimeFormat("en-US", { weekday: "short" }).format(parsed)}, ${formatClockTime(parsed)}`;
  }

  if (timeFormat === "relative") {
    return formatRelativePlayDate(parsed);
  }

  return formatStableDateTime(parsed);
}

function formatRelativePlayDate(value: Date): string {
  const elapsedMs = Date.now() - value.getTime();
  const elapsedMinutes = Math.floor(elapsedMs / (60 * 1000));
  let relativeText: string;
  if (elapsedMinutes < 1) {
    relativeText = "Just now";
  } else if (elapsedMinutes < 60) {
    relativeText = `${elapsedMinutes}m ago`;
  } else {
    const elapsedHours = Math.floor(elapsedMinutes / 60);
    relativeText = elapsedHours < 24 ? `${elapsedHours}h ago` : `${Math.floor(elapsedHours / 24)}d ago`;
  }

  return `${relativeText} ${formatClockTime(value)}`;
}

function isWithinPastWeek(value: Date): boolean {
  const elapsedMs = Date.now() - value.getTime();
  return elapsedMs >= 0 && elapsedMs < 7 * 24 * 60 * 60 * 1000;
}

function nextPerformanceTimeFormat(timeFormat: PerformanceTimeFormat): PerformanceTimeFormat {
  if (timeFormat === "datetime") {
    return "weekday";
  }
  return timeFormat === "weekday" ? "relative" : "datetime";
}

function performanceTimeFormatLabel(timeFormat: PerformanceTimeFormat): string {
  if (timeFormat === "datetime") {
    return "date and time";
  }
  return timeFormat === "weekday" ? "weekday and time" : "relative time";
}

function formatStableDateTime(value: Date): string {
  const month = new Intl.DateTimeFormat("en-US", { month: "short" }).format(value);
  const day = new Intl.DateTimeFormat("en-US", { day: "numeric" }).format(value);
  return `${month} ${day}, ${formatClockTime(value)}`;
}

function formatClockTime(value: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
  }).format(value);
}

function formatCatalogHistoryDate(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(parsed);
}

function formatFolderLabel(song: PublicSong): string {
  const folder = (song.folder ?? "Unassigned").toUpperCase();
  if (song.folderPosition) {
    return `${folder} ${song.folderPosition}`;
  }
  return folder;
}

function formatBpmLabel(bpm: string | null): string | null {
  const value = bpm?.replace(/\s*\bBPM\b\s*$/i, "").trim();
  return value ? `${value} BPM` : null;
}
