"use client";

import { ShieldCheck } from "lucide-react";

import { useAdminViewMode } from "@/lib/admin-view-mode";

export function FooterAdminDashboardLink({ enabled }: { enabled: boolean }) {
  const { viewingAsRegular } = useAdminViewMode();

  if (!enabled || viewingAsRegular) {
    return null;
  }

  return (
    <a
      aria-label="View admin dashboard"
      className="inline-flex h-10 w-10 items-center justify-center border border-[#28c950] bg-white text-[#1f5f39] transition hover:border-[#171916] hover:text-[#171916]"
      href="/admin"
      title="Admin dashboard"
    >
      <ShieldCheck aria-hidden="true" size={16} />
    </a>
  );
}
