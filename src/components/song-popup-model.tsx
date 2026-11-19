"use client";

import { ArrowLeft, Bookmark, Clock3, ExternalLink, Folder, Link2, Music2, Star, Tag, X } from "lucide-react";
import { motion } from "motion/react";
import type { ReactNode } from "react";

import { SongPreviewPlayButton } from "@/components/song-preview-play-button";
import type { PublicSong } from "@/lib/types";

const chartTokens = ["S13", "S17", "S22", "S25", "D18", "D24", "D27"];

export function SongPopupModel({ song }: { song: PublicSong | null }) {
  const title = song?.title ?? "Freedom Dive";
  const artist = song?.artist ?? "xi";
  const bpm = song?.bpm ?? "222.22 BPM";
  const imageUrl = song?.imageUrl;
  const previewUrl = song?.previewUrl ?? null;

  return (
    <div className="relative h-[560px] overflow-visible bg-transparent sm:h-[610px] lg:h-[590px]">
      <motion.div
        className="absolute left-1/2 top-[47%] w-[min(760px,calc(100vw-2.25rem))] origin-center -translate-x-1/2 -translate-y-1/2"
        initial={{ opacity: 0, y: 28, rotateX: 14, rotateZ: 3.6, scale: 0.62 }}
        whileInView={{ opacity: 1, y: 0, rotateZ: 6.2, scale: 0.66 }}
        viewport={{ once: true }}
        transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
        style={{ perspective: 1400 }}
      >
        <motion.div
          className="relative overflow-hidden rounded-2xl border border-white/80 bg-[#fbfcf7] p-5 shadow-[0_34px_110px_rgba(28,34,24,0.22),0_10px_34px_rgba(40,201,80,0.08)] sm:p-6"
          animate={{ rotateX: [8, 10, 8], rotateY: [-12, -9, -12], y: [0, -8, 0] }}
          transition={{ duration: 7, repeat: Infinity, ease: "easeInOut" }}
          style={{ transformStyle: "preserve-3d" }}
        >
          <div className="mb-6 flex items-start justify-between gap-4">
            <div className="inline-flex items-center gap-2 text-sm font-black text-[#596153]">
              <ArrowLeft aria-hidden="true" size={16} />
              Catalog
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <RoundAction icon={<ExternalLink aria-hidden="true" size={16} />} label="Open full page" />
              <RoundAction icon={<Link2 aria-hidden="true" size={16} />} label="Copy link" />
              <RoundAction selected icon={<Star aria-hidden="true" fill="currentColor" size={16} />} label="Favorite" />
              <RoundAction icon={<X aria-hidden="true" size={17} />} label="Close" />
            </div>
          </div>

          <div className="grid gap-6 lg:grid-cols-[190px_minmax(0,1fr)]">
            <div>
              <div className="relative aspect-square overflow-hidden rounded-lg border border-[#d6ddcf] bg-[#dfe6d8] shadow-[0_20px_45px_rgba(18,24,16,0.12)] hidden lg:block">
                {imageUrl ? (
                  <span aria-hidden="true" className="block size-full bg-cover bg-center" style={{ backgroundImage: `url(${imageUrl})` }} />
                ) : (
                  <span aria-hidden="true" className="block size-full bg-[linear-gradient(135deg,#d8f4e3,#dcecff_45%,#fff0be)]" />
                )}
                <SongPreviewPlayButton previewUrl={previewUrl} title={title} />
              </div>
            </div>

            <div className="min-w-0">
              <div className="flex flex-wrap gap-2">
                <MetaChip icon={<Music2 aria-hidden="true" size={14} />} label="PHOENIX 2" />
                <MetaChip icon={<Folder aria-hidden="true" size={14} />} label="World Music" />
                <MetaChip icon={<Music2 aria-hidden="true" size={14} />} label={bpm} />
              </div>

              <h3 className="mt-4 max-w-[520px] text-[clamp(2.35rem,5vw,4rem)] font-black leading-[0.94] tracking-normal text-[#11130f]">
                {title}
              </h3>
              <p className="mt-4 text-2xl font-black text-[#596153]">{artist}</p>

              <SectionDivider />

              <FeatureRow icon={<Music2 aria-hidden="true" size={15} />} label="Charts">
                <div className="flex flex-wrap gap-2">
                  {chartTokens.map((token, index) => (
                    <span
                      key={token}
                      className={`inline-flex min-h-8 min-w-12 items-center justify-center border px-3 text-sm font-black ${index === chartTokens.length - 1 ? "border-[#171916] bg-[#171916] text-white" : "border-[#d6ddcf] bg-white text-[#4f5849]"}`}
                    >
                      {token}
                    </span>
                  ))}
                </div>
              </FeatureRow>

              <SectionDivider />

              <FeatureRow icon={<Tag aria-hidden="true" size={15} />} label="Tags">
                <span className="inline-flex min-h-8 items-center border border-[#2f9b62] bg-[#eaffef] px-3 text-sm font-black text-[#1f7a43]">
                  runs <span className="ml-2 text-xs">1</span>
                </span>
                <p className="mt-3 text-sm font-black uppercase text-[#596153]">My tag votes</p>
              </FeatureRow>

              <SectionDivider />

              <FeatureRow icon={<Bookmark aria-hidden="true" size={15} />} label="Community">
                <div className="border-l-4 border-[#cfe0c8] bg-white p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-black text-[#171916]">pkimchi</p>
                      <p className="text-xs font-black text-[#66705f]">7/30/2026</p>
                    </div>
                    <span className="text-xs font-black uppercase text-[#596153]">Clip attached</span>
                  </div>
                  <p className="mt-3 text-sm font-medium text-[#4f5849]">what 20 years of pump looks like</p>
                  <div className="mt-3 aspect-[16/9] overflow-hidden bg-[#162533] shadow-inner">
                    <div className="flex h-full flex-col justify-between bg-[radial-gradient(circle_at_58%_28%,rgba(70,244,252,0.42),transparent_20%),linear-gradient(135deg,#1c3345,#0d1720_60%,#263b45)] p-4">
                      <div className="flex items-start justify-between">
                        <span className="border border-white/30 bg-white/15 px-2 py-1 text-xs font-black text-white">STAGE 03</span>
                        <span className="text-xs font-black uppercase text-[#baff5f]">PHOENIX 2</span>
                      </div>
                      <div className="self-center text-center">
                        <p className="text-2xl font-black italic tracking-normal text-[#39dfff]">PERFECT</p>
                        <p className="text-sm font-black text-white">COMBO 153</p>
                      </div>
                      <div className="flex justify-center gap-3 text-xl font-black text-white">
                        <span>↙</span>
                        <span className="text-[#ffca6d]">●</span>
                        <span className="text-[#47a9ff]">↘</span>
                      </div>
                    </div>
                  </div>
                  <p className="mt-2 text-xs font-black text-[#596153]">948198 TG!</p>
                </div>
              </FeatureRow>

              <SectionDivider />

              <FeatureRow icon={<Clock3 aria-hidden="true" size={15} />} label="History">
                <p className="text-sm font-medium text-[#56604e]">Released PHOENIX 2 07/2026</p>
              </FeatureRow>
            </div>
          </div>
        </motion.div>
      </motion.div>
    </div>
  );
}

function RoundAction({
  icon,
  label,
  selected = false,
}: {
  icon: ReactNode;
  label: string;
  selected?: boolean;
}) {
  return (
    <button
      aria-label={label}
      className={`flex size-10 items-center justify-center rounded-full border bg-white text-[#596153] shadow-[0_10px_28px_rgba(18,24,16,0.1)] ${selected ? "border-[#f1cd7f] text-[#f3b343]" : "border-[#d6ddcf]"}`}
      type="button"
    >
      {icon}
    </button>
  );
}

function MetaChip({ icon, label }: { icon: ReactNode; label: string }) {
  return (
    <span className="inline-flex min-h-8 items-center gap-2 border border-[#cfd8c8] bg-white px-3 text-xs font-black uppercase text-[#596153]">
      {icon}
      {label}
    </span>
  );
}

function SectionDivider() {
  return <div className="my-5 h-px bg-[#d9ded2]" />;
}

function FeatureRow({
  children,
  icon,
  label,
}: {
  children: ReactNode;
  icon: ReactNode;
  label: string;
}) {
  return (
    <section>
      <div className="mb-3 flex items-center gap-2 text-sm font-black uppercase text-[#596153]">
        {icon}
        {label}
      </div>
      {children}
    </section>
  );
}
