"use client";

import { motion } from "motion/react";
import type { ReactNode } from "react";

/** Keep fast chart selection while exposing a real shareable/new-tab URL. */
export function SongChartLink({ href, selected, className, onSelect, children }: {
  href: string;
  selected: boolean;
  className: string;
  onSelect: () => void;
  children: ReactNode;
}) {
  return <motion.a
    href={href}
    aria-current={selected ? "true" : undefined}
    className={className}
    onClick={(event) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      onSelect();
    }}
    whileHover={{ y: -2, scale: 1.04 }}
    transition={{ type: "spring", stiffness: 360, damping: 26 }}
  >{children}</motion.a>;
}
