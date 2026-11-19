"use client";

import Image from "next/image";
import { useState } from "react";

import type { PerformanceResultBadge as Badge } from "@/lib/performance-result-badges";

export function PerformanceResultBadge({ badge, kind }: { badge: Badge | null; kind: "grade" | "plate" }) {
  if (!badge) return null;
  return <ResultBadge key={badge.image?.src ?? badge.label} badge={badge} kind={kind} />;
}

function ResultBadge({ badge, kind }: { badge: Badge; kind: "grade" | "plate" }) {
  const [imageFailed, setImageFailed] = useState(false);
  return (
    <span
      aria-label={badge.label}
      className={`inline-flex w-[4.5rem] shrink-0 items-center ${kind === "grade" ? "h-8" : "h-5"}`}
      role="img"
      title={badge.label}
    >
      {badge.image && !imageFailed ? (
        <Image
          alt=""
          aria-hidden="true"
          className="h-full w-auto max-w-full object-contain"
          height={badge.image.height}
          onError={() => setImageFailed(true)}
          sizes="72px"
          src={badge.image.src}
          width={badge.image.width}
        />
      ) : (
        <span aria-hidden="true" className="truncate text-sm font-black text-[#596153]">{badge.text}</span>
      )}
    </span>
  );
}
