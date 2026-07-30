"use client";

import { Eye } from "lucide-react";

import { useAdminViewMode } from "@/lib/admin-view-mode";

export function AdminViewBadge() {
  const { mode, setMode, viewingAsRegular } = useAdminViewMode();
  const nextMode = viewingAsRegular ? "admin" : "regular";

  return (
    <button
      className={`inline-flex h-12 w-12 items-center justify-center border bg-white/70 shadow-[0_10px_28px_rgba(29,35,24,0.07)] backdrop-blur transition hover:bg-white ${
        viewingAsRegular
          ? "border-[#cdd5c5] text-[#56604e] hover:border-[#28c950] hover:text-[#1f5f39]"
          : "border-[#28c950] text-[#1f5f39] hover:border-[#171916] hover:text-[#171916]"
      }`}
      type="button"
      onClick={() => setMode(nextMode)}
      aria-label={`View as ${nextMode}`}
      title={`Currently viewing as ${mode}. Switch to ${nextMode}.`}
    >
      <Eye aria-hidden="true" size={17} />
    </button>
  );
}
