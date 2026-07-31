"use client";

import { ArrowLeft, Disc3, Folder, History, Maximize2, Minimize2, Music, Music2, Star, Tag } from "lucide-react";
import { MotionConfig, motion, useScroll, useSpring, useTransform } from "motion/react";
import Image from "next/image";
import Link from "next/link";
import { useState, type CSSProperties } from "react";

import { CatalogAdminEditor } from "@/components/catalog-admin-editor";
import { SongCommunityPanel } from "@/components/song-community-panel";
import { SongPreviewPlayButton } from "@/components/song-preview-play-button";
import type { PublicUser, SongCommunityState } from "@/lib/auth";
import type { PublicSong } from "@/lib/types";

interface SongDetailViewProps {
  song: PublicSong;
  community?: {
    user: PublicUser | null;
    initialState: SongCommunityState;
  };
  communityReadOnly?: boolean;
  initialSelectedChartToken?: string | null;
  previewVolume?: number;
  userIsAdmin?: boolean;
  mode?: "page" | "notebook";
  onBack?: () => void;
  onCatalogSaved?: (song: PublicSong) => void;
}

const sectionMotion = {
  initial: { opacity: 0, y: 14 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, margin: "-80px" },
  transition: { duration: 0.38, ease: [0.22, 1, 0.36, 1] },
} as const;

export function SongDetailView({ song, community, communityReadOnly = false, initialSelectedChartToken = null, previewVolume, userIsAdmin = false, mode = "page", onBack, onCatalogSaved }: SongDetailViewProps) {
  const [currentSong, setCurrentSong] = useState(song);
  const [selectedChartToken, setSelectedChartToken] = useState<string | null>(
    initialSelectedChartToken && song.chartSummary.includes(initialSelectedChartToken) ? initialSelectedChartToken : song.chartSummary[0] ?? null,
  );
  const [favoriteSaved, setFavoriteSaved] = useState(community?.initialState.saved ?? false);
  const [favoriteSaving, setFavoriteSaving] = useState(false);
  const [compactView, setCompactView] = useState(community?.user?.preferences.songDetailCompactView ?? false);
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

  function handleCatalogSaved(updatedSong: PublicSong) {
    setCurrentSong(updatedSong);
    if (!selectedChartToken || !updatedSong.chartSummary.includes(selectedChartToken)) {
      setSelectedChartToken(updatedSong.chartSummary[0] ?? null);
    }
    onCatalogSaved?.(updatedSong);
  }
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
      <p className="text-sm font-medium text-[#66705f]">
        Changelog entries and deeper infograph data can be layered into this page next.
      </p>
    </motion.section>
  );

  async function toggleFavorite() {
    if (!community?.user) {
      return;
    }

    setFavoriteSaving(true);
    try {
      const response = await fetch(`/api/songs/${encodeURIComponent(currentSong.slug)}/community`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "save", saved: !favoriteSaved }),
      });
      const body = (await response.json()) as { state?: SongCommunityState };
      if (response.ok && body.state) {
        setFavoriteSaved(body.state.saved);
      }
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
        className={`song-detail-shell mx-auto grid max-w-6xl px-5 py-8 sm:px-8 lg:px-10 ${isCompact ? "gap-6 lg:grid-cols-[var(--song-detail-art-width)_minmax(0,1fr)]" : `gap-8 ${isNotebook ? "pb-12 lg:grid-cols-[auto_minmax(0,1fr)]" : "lg:grid-cols-[var(--song-detail-art-width)_minmax(0,1fr)]"}`}`}
        layout
        style={!isNotebook ? ({ "--song-detail-art-width": imageColumnWidth } as CSSProperties) : undefined}
        transition={{ layout: { type: "spring", stiffness: 180, damping: 26, mass: 0.9 } }}
      >
        <motion.div className="lg:sticky lg:top-6 lg:self-start" layout style={isNotebook ? { width: imageWidth } : undefined}>
          {onBack ? (
            <button className="mb-5 inline-flex items-center gap-2 text-sm font-bold text-[#56604e] hover:text-[#28c950]" type="button" onClick={onBack}>
              <ArrowLeft aria-hidden="true" size={17} />
              Catalog
            </button>
          ) : (
            <Link className="mb-5 inline-flex items-center gap-2 text-sm font-bold text-[#56604e] hover:text-[#28c950]" href="/">
              <ArrowLeft aria-hidden="true" size={17} />
              Catalog
            </Link>
          )}
          {jacketImage}
        </motion.div>

      <motion.div className="pt-10" layout transition={{ layout: { type: "spring", stiffness: 180, damping: 26, mass: 0.9 } }}>
        <motion.div {...sectionMotion} className="mb-4 flex items-start justify-between gap-3">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-2 border border-[#cdd5c5] bg-white px-3 py-1.5 text-sm font-black uppercase text-[#596153]">
              <Disc3 aria-hidden="true" size={16} />
              {seriesLabel}
            </span>
            <span className="inline-flex items-center gap-2 border border-[#cdd5c5] bg-white px-3 py-1.5 text-sm font-black uppercase text-[#596153]">
              <Folder aria-hidden="true" size={16} />
              {folderLabel}
            </span>
            {bpmLabel ? (
              <span className="inline-flex items-center gap-2 border border-[#cdd5c5] bg-white px-3 py-1.5 text-sm font-black uppercase text-[#596153]" aria-label={bpmLabel}>
                <Music aria-hidden="true" size={16} />
                {bpmLabel}
              </span>
            ) : null}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <CatalogAdminEditor label="song details" song={currentSong} userIsAdmin={userIsAdmin} onSaved={handleCatalogSaved} />
            {canToggleCompact ? (
              <button
                aria-label={compactView ? "Show full screen view" : "Show small screen view"}
                aria-pressed={compactView}
                className="inline-flex h-10 w-10 items-center justify-center border border-[#cdd5c5] bg-white text-[#596153] transition hover:border-[#28c950] hover:text-[#28c950]"
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
          <motion.div className="min-w-0" layout transition={{ type: "spring", stiffness: 190, damping: 28, mass: 0.9 }}>
            <motion.div className="flex items-start gap-3" layout transition={{ type: "spring", stiffness: 190, damping: 28, mass: 0.9 }}>
              <motion.h1 className="text-5xl font-black leading-none tracking-normal text-[#11130f] sm:text-7xl" layout>
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
                  onClick={() => setSelectedChartToken(chart)}
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

        {community ? (
          <SongCommunityPanel
            key={`${currentSong.slug}:${community.initialState.posts.length}:${community.initialState.communityTags.length}:${community.initialState.tagVotes.length}:${community.initialState.note.length}`}
            afterCommunity={historySection}
            initialState={community.initialState}
            readOnly={communityReadOnly}
            selectedChartToken={selectedChartToken}
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

function formatFolderLabel(song: PublicSong): string {
  const folder = (song.folder ?? "Unassigned").toUpperCase();
  if (song.folderPosition && song.folderSongCount) {
    return `${folder} ${song.folderPosition}/${song.folderSongCount}`;
  }
  if (song.folderSongCount) {
    return `${folder} ${song.folderSongCount} songs`;
  }
  return folder;
}

function formatBpmLabel(bpm: string | null): string | null {
  const value = bpm?.replace(/\s*\bBPM\b\s*$/i, "").trim();
  return value ? `${value} BPM` : null;
}
