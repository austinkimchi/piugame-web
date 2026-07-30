"use client";

import { ArrowLeft, Disc3, Folder, History, Music2, Star, Tag } from "lucide-react";
import { MotionConfig, motion, useScroll, useSpring, useTransform } from "motion/react";
import Image from "next/image";
import Link from "next/link";
import { useState } from "react";

import { CatalogAdminEditor } from "@/components/catalog-admin-editor";
import { SongCommunityPanel } from "@/components/song-community-panel";
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
  userIsAdmin?: boolean;
  mode?: "page" | "notebook";
  onBack?: () => void;
}

const sectionMotion = {
  initial: { opacity: 0, y: 14 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, margin: "-80px" },
  transition: { duration: 0.38, ease: [0.22, 1, 0.36, 1] },
} as const;

export function SongDetailView({ song, community, communityReadOnly = false, initialSelectedChartToken = null, userIsAdmin = false, mode = "page", onBack }: SongDetailViewProps) {
  const [selectedChartToken, setSelectedChartToken] = useState<string | null>(
    initialSelectedChartToken && song.chartSummary.includes(initialSelectedChartToken) ? initialSelectedChartToken : song.chartSummary[0] ?? null,
  );
  const [favoriteSaved, setFavoriteSaved] = useState(community?.initialState.saved ?? false);
  const [favoriteSaving, setFavoriteSaving] = useState(false);
  const { scrollY } = useScroll();
  const imageScale = useSpring(useTransform(scrollY, [0, 420], [1, 0.78]), { stiffness: 180, damping: 28 });
  const notebookImageWidth = useSpring(useTransform(scrollY, [0, 420], [360, 281]), { stiffness: 180, damping: 28 });
  const imageShadow = useTransform(
    scrollY,
    [0, 420],
    ["0 18px 55px rgba(29,35,24,0.10)", "0 12px 36px rgba(29,35,24,0.14)"],
  );
  const imageRadius = useTransform(scrollY, [0, 420], ["0px", "10px"]);
  const isNotebook = mode === "notebook";
  const canFavorite = Boolean(community?.user);
  const seriesLabel = (song.series ?? "Unknown series").toUpperCase();
  const folderLabel = formatFolderLabel(song);
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
      const response = await fetch(`/api/songs/${encodeURIComponent(song.slug)}/community`, {
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

  return (
    <MotionConfig reducedMotion="user">
      <section className={`song-detail-shell mx-auto grid max-w-6xl gap-8 px-5 py-8 sm:px-8 lg:px-10 ${isNotebook ? "pb-12 lg:grid-cols-[auto_minmax(0,1fr)]" : "lg:grid-cols-[360px_minmax(0,1fr)]"}`}>
        <motion.div className="lg:sticky lg:top-6 lg:self-start" style={isNotebook ? { width: notebookImageWidth } : undefined}>
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
          <motion.div
            className={`relative aspect-square w-full overflow-hidden border border-[#d6ddcf] bg-white ${isNotebook ? "" : "mx-auto max-w-[360px] origin-top-left"}`}
            style={{
              borderRadius: imageRadius,
              boxShadow: imageShadow,
              scale: isNotebook ? 1 : imageScale,
            }}
          >
            {song.imageUrl ? (
              <Image alt={`${song.title} jacket`} className="object-cover" fill priority sizes="360px" src={song.imageUrl} />
            ) : (
              <div className="flex h-full items-center justify-center font-bold text-[#66705f]">No jacket</div>
            )}
          </motion.div>
        </motion.div>

      <div className="pt-10">
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
            <CatalogAdminEditor focus="song" label="song details" song={song} userIsAdmin={userIsAdmin} />
          </div>
          {community && !isNotebook ? (
            canFavorite ? (
              <button
                aria-label={favoriteSaved ? "Remove favorite" : "Favorite song"}
                className={`inline-flex h-10 w-10 shrink-0 items-center justify-center border transition ${favoriteSaved ? "border-[#e2cd96] bg-[#fff4cf] text-[#ffca6d]" : "border-[#cdd5c5] bg-white text-[#596153] hover:border-[#28c950] hover:text-[#28c950]"} disabled:opacity-60`}
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
                className="inline-flex h-10 w-10 shrink-0 items-center justify-center border border-[#cdd5c5] bg-white text-[#596153] transition hover:border-[#28c950] hover:text-[#28c950]"
                href={`/api/auth/google/login?next=/songs/${song.slug}`}
                title="Sign in to favorite"
              >
                <Star aria-hidden="true" size={19} />
              </Link>
            )
          ) : null}
        </motion.div>
        <motion.div
          className="flex items-start gap-3"
          initial={{ opacity: 0, y: 20, filter: "blur(8px)" }}
          animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
          transition={{ duration: 0.48, ease: [0.22, 1, 0.36, 1] }}
        >
          <h1 className="text-5xl font-black leading-none tracking-normal text-[#11130f] sm:text-7xl">{song.title}</h1>
          <div className="mt-2 sm:mt-4">
            <CatalogAdminEditor focus="song" label="song details" song={song} userIsAdmin={userIsAdmin} />
          </div>
        </motion.div>
        <motion.p
          className="mt-4 text-2xl font-bold text-[#4f5849]"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.08, duration: 0.38, ease: [0.22, 1, 0.36, 1] }}
        >
          {song.artist}
        </motion.p>

        <motion.section {...sectionMotion} className="mt-8 border-y border-[#d9ded2] py-6">
          <div className="mb-3 flex items-center gap-2 text-sm font-black uppercase text-[#596153]">
            <Music2 aria-hidden="true" size={17} />
            Charts
            <CatalogAdminEditor focus="charts" label="charts" song={song} userIsAdmin={userIsAdmin} />
          </div>
          <div className="flex flex-wrap gap-2">
            {song.chartSummary.length > 0 ? (
              song.chartSummary.map((chart) => (
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
            key={`${song.slug}:${community.initialState.posts.length}:${community.initialState.communityTags.length}:${community.initialState.tagVotes.length}:${community.initialState.note.length}`}
            afterCommunity={historySection}
            initialState={community.initialState}
            readOnly={communityReadOnly}
            selectedChartToken={selectedChartToken}
            song={song}
            user={community.user}
          />
        ) : (
          <motion.section {...sectionMotion} className="mt-6 border-b border-[#d9ded2] pb-6">
            <div className="mb-3 flex items-center gap-2 text-sm font-black uppercase text-[#596153]">
              <Tag aria-hidden="true" size={17} />
              Tags
            </div>
            <div className="flex flex-wrap gap-2">
              {song.tags.length > 0 ? (
                song.tags.map((tag) => (
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

      </div>
      </section>
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
