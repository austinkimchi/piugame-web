"use client";

import { ArrowRight, MessageSquareText, Search, Star, Tags } from "lucide-react";
import dynamic from "next/dynamic";
import { motion } from "motion/react";

import type { PublicSong } from "@/lib/types";

const SongPopupModel = dynamic(
  () => import("@/components/song-popup-model").then((module) => module.SongPopupModel),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full min-h-[420px] items-center justify-center border border-[#d9ded2] bg-[#fbfcf7] text-sm font-black uppercase text-[#66705f]">
        Building preview
      </div>
    ),
  },
);

const features = [
  {
    icon: Search,
    title: "Find charts fast",
    body: "Search by title, artist, folder, series, tag, or exact chart level.",
  },
  {
    icon: Star,
    title: "Favorite Songs",
    body: "Keep your clears, grind targets, and next-session picks close at hand.",
  },
  {
    icon: Tags,
    title: "Share your moment",
    body: "Post the clears, breakthroughs, and close calls that make each chart yours.",
  },
  {
    icon: MessageSquareText,
    title: "Track each chart",
    body: "Add goals, screenshots, and reminders directly to the song detail view.",
  },
];

export function GuestFeatureShowcase({
  featureSong,
  onExplore,
}: {
  featureSong: PublicSong | null;
  onExplore: () => void;
}) {
  return (
    <motion.section
      className="feature-showcase relative overflow-hidden border-y border-[#d9ded2] bg-[#f3f6ef] lg:overflow-visible"
      initial={{ opacity: 0, y: 18 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-80px" }}
      transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
    >
      <div className="relative z-10 mx-auto grid max-w-7xl gap-6 px-5 py-8 sm:px-8 lg:grid-cols-[minmax(330px,0.84fr)_minmax(0,1.16fr)] lg:items-center lg:gap-8 lg:px-10 lg:py-14">
        <div className="relative z-10">
          <h2 className="max-w-2xl text-4xl font-black leading-none tracking-normal text-[#11130f] sm:text-5xl">
            Turn every<br/>song into your<br/>personal notebook.
          </h2>
          <p className="mt-5 max-w-xl text-base font-medium leading-7 text-[#56604e]">
            MyPIU offers a home for Pump It Up players that want to  share their plays and keep track of their favorite songs. 
          </p>

          <div className="mt-6 grid grid-cols-2 gap-2 sm:grid-cols-1 sm:gap-3 lg:mt-7">
            {features.map((feature, index) => {
              const Icon = feature.icon;

              return (
                <motion.article
                  key={feature.title}
                  className="grid min-h-[4.25rem] grid-cols-[2.25rem_minmax(0,1fr)] gap-2 border border-[#d5ddce] bg-white/84 p-2 shadow-[0_10px_34px_rgba(25,32,22,0.06)] backdrop-blur sm:min-h-0 sm:grid-cols-[2.75rem_minmax(0,1fr)] sm:gap-3 sm:p-3"
                  initial={{ opacity: 0, x: -16 }}
                  whileInView={{ opacity: 1, x: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: index * 0.05, duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
                >
                  <span className="flex size-9 items-center justify-center border border-[#bfd2c1] bg-[#eaffef] text-[#1f7a43] sm:size-11">
                    <Icon aria-hidden="true" size={19} />
                  </span>
                  <span className="min-w-0">
                    <strong className="block text-xs font-black uppercase leading-5 text-[#171916] sm:text-sm">{feature.title}</strong>
                    <span className="mt-1 hidden text-sm font-medium leading-6 text-[#64705d] sm:block">{feature.body}</span>
                  </span>
                </motion.article>
              );
            })}
          </div>

          <div className="mt-7 flex flex-wrap gap-3">
            <motion.a
              className="inline-flex min-h-11 items-center gap-2 border border-[#171916] bg-[#171916] px-5 py-3 text-sm font-black text-white transition hover:bg-[#343b30]"
              href="/api/auth/google/login?next=/"
              whileHover={{ y: -3, scale: 1.02 }}
              whileTap={{ scale: 0.97 }}
            >
              Sign in to build yours
              <ArrowRight aria-hidden="true" size={17} />
            </motion.a>
            <motion.button
              className="inline-flex min-h-11 items-center gap-2 border border-[#c5cfc0] bg-white px-5 py-3 text-sm font-black text-[#171916] transition hover:bg-[#eef1e8]"
              type="button"
              whileHover={{ y: -3, scale: 1.02 }}
              whileTap={{ scale: 0.97 }}
              onClick={onExplore}
            >
              Browse catalog
            </motion.button>
          </div>
        </div>

        <div className="pointer-events-none absolute inset-x-0 bottom-0 top-24 z-0 opacity-20 sm:top-16 lg:pointer-events-auto lg:relative lg:inset-auto lg:z-auto lg:mt-10 lg:min-h-[640px] lg:opacity-100">
          <SongPopupModel song={featureSong} />
        </div>
      </div>
    </motion.section>
  );
}
