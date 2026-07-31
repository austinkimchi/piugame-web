"use client";

import { Search, Sparkles, Volume2 } from "lucide-react";
import { MotionConfig, motion, type Variants } from "motion/react";
import type { ReactNode } from "react";

const heroContainer: Variants = {
  hidden: {},
  visible: {
    transition: {
      staggerChildren: 0.09,
    },
  },
};

const heroItem: Variants = {
  hidden: { opacity: 0, y: 18, filter: "blur(8px)" },
  visible: {
    opacity: 1,
    y: 0,
    filter: "blur(0px)",
    transition: { duration: 0.6, ease: [0.22, 1, 0.36, 1] },
  },
};

export function HomeHero({ accountSlot }: { accountSlot?: ReactNode }) {
  return (
    <MotionConfig reducedMotion="user">
      <section className="hero-stage relative overflow-hidden border-b border-[#d9ded2] bg-[#fbfcf7]">
      <motion.div
        className="relative z-10 mx-auto flex min-h-[42vh] max-w-7xl flex-col justify-end px-5 pb-8 pt-5 sm:px-8 sm:pt-16 lg:px-10"
        initial="hidden"
        animate="visible"
        variants={heroContainer}
      >
        {accountSlot ? <div className="mb-7 flex justify-end sm:absolute sm:right-8 sm:top-5 sm:mb-0 lg:right-10">{accountSlot}</div> : null}
        <motion.div variants={heroItem} className="mb-7 flex flex-wrap items-center gap-3 text-sm font-medium text-[#596153]">
          <motion.span
            className="hero-chip inline-flex items-center gap-2 border border-[#cdd5c5] bg-white px-3 py-1.5"
            whileHover={{ y: -3, scale: 1.03 }}
            whileTap={{ scale: 0.98 }}
          >
            <Volume2 aria-hidden="true" size={16} />
            Supports Song Previews
          </motion.span>
          <motion.span
            className="hero-chip hero-chip-delayed inline-flex items-center gap-2 border border-[#cdd5c5] bg-white px-3 py-1.5"
            whileHover={{ y: -3, scale: 1.03 }}
            whileTap={{ scale: 0.98 }}
          >
            <Sparkles aria-hidden="true" size={16} />
            Phoenix 2
          </motion.span>
        </motion.div>
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_360px] lg:items-end">
          <motion.div variants={heroItem} className="hero-copy">
            <h1 className="hero-title max-w-4xl text-5xl font-black leading-[0.95] tracking-normal text-[#11130f] sm:text-7xl">
              MyPIU
            </h1>
            <p className="mt-5 max-w-2xl text-lg leading-8 text-[#4f5849]">
              A searchable Pump It Up catalog for charts, version history, and previews.
            </p>
          </motion.div>
          <motion.div
            variants={heroItem}
            className="hero-control-card border-l-4 border-[#28c950] bg-white p-5 shadow-[0_18px_55px_rgba(29,35,24,0.08)]"
            whileHover={{ y: -6, rotateX: 2 }}
            transition={{ type: "spring", stiffness: 260, damping: 24 }}
          >
            <div className="flex items-center gap-3 text-sm font-semibold uppercase tracking-normal text-[#596153]">
              <Search aria-hidden="true" size={17} />
              Latest Catalog
            </div>
            <p className="mt-3 text-sm leading-6 text-[#56604e]">
              Your personal notebook for the songs you are learning, clearing, and coming back to.
            </p>
          </motion.div>
        </div>
      </motion.div>
      </section>
    </MotionConfig>
  );
}
