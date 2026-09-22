"use client";

import Link from "next/link";
import { AlertTriangle, GitFork, History, Mail, MessageSquare, Send, ShieldCheck, X } from "lucide-react";
import { AnimatePresence, MotionConfig, motion } from "motion/react";
import { type FormEvent, useMemo, useState } from "react";

import { FooterAdminDashboardLink } from "@/components/footer-admin-dashboard-link";

type FeedbackKind = "catalog-error" | "catalog-contribution" | "owner-message";
type SubmitState = "idle" | "sending" | "sent" | "error";

const FEEDBACK_CONFIG: Record<
  FeedbackKind,
  {
    title: string;
    button: string;
    icon: typeof AlertTriangle;
    intro: string;
    scenarios: Array<{ value: string; label: string }>;
    placeholder: string;
  }
> = {
  "catalog-error": {
    title: "Report catalog error",
    button: "Report error",
    icon: AlertTriangle,
    intro: "Tell us what looks wrong so the community catalog can be corrected.",
    scenarios: [
      { value: "title-artist", label: "Wrong title or artist" },
      { value: "jacket-image", label: "Wrong, missing, or broken jacket image" },
      { value: "preview-audio", label: "Wrong, missing, or broken song preview" },
      { value: "charts-levels", label: "Wrong or missing charts/levels" },
      { value: "folder-series", label: "Wrong folder, series, or version" },
      { value: "duplicate-missing", label: "Duplicate song or missing song" },
      { value: "search-filter", label: "Search, filter, or page behavior issue" },
      { value: "other-error", label: "Other catalog issue" },
    ],
    placeholder: "Include the song title, expected value, source if you have one, and what currently appears.",
  },
  "catalog-contribution": {
    title: "Contribute to catalog",
    button: "Contribute",
    icon: History,
    intro: "Share additions that should be layered into the catalog or history sections.",
    scenarios: [
      { value: "history-entry", label: "Add a history or changelog entry" },
      { value: "missing-song", label: "Add a missing song" },
      { value: "chart-source", label: "Add chart/source evidence" },
      { value: "metadata", label: "Add folder, series, tag, or metadata detail" },
      { value: "asset-source", label: "Add image, audio, or asset source" },
      { value: "moderator-application", label: "Apply for moderator" },
    ],
    placeholder: "Describe the contribution and include links, dates, versions, or source material that can verify it.",
  },
  "owner-message": {
    title: "Message page owner",
    button: "Message",
    icon: MessageSquare,
    intro: "Send a general note that is not tied to a specific catalog correction.",
    scenarios: [
      { value: "general", label: "General question" },
      { value: "feature-request", label: "Feature request" },
      { value: "privacy-removal", label: "Privacy, credit, or removal request" },
      { value: "bug-report", label: "Site bug outside catalog data" },
      { value: "collaboration", label: "Collaboration or project message" },
    ],
    placeholder: "Write your message for the site owner.",
  },
};

const GITHUB_REPO_URL = "https://github.com/austinkimchi/piugame-sdk";

export function SiteFooter({ showAdminDashboardLink = false }: { showAdminDashboardLink?: boolean }) {
  const [openKind, setOpenKind] = useState<FeedbackKind | null>(null);
  const year = new Date().getFullYear();

  return (
    <footer className="border-t border-[#d9ded2] bg-[#fbfcf7] text-[#4f5849]">
      <div className="mx-auto grid max-w-7xl gap-6 px-5 py-8 sm:px-8 lg:grid-cols-[minmax(0,1fr)_auto] lg:px-10">
        <div>
          <p className="text-sm font-black text-[#171916]">MyPIU</p>
          <p className="mt-2 max-w-2xl text-sm leading-6">
            Song catalog, history, and previews. This site is not affiliated with ANDAMIRO.
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-3 text-sm font-bold">
            <a className="inline-flex items-center gap-2 text-[#3d4638] hover:text-[#28c950]" href={GITHUB_REPO_URL} rel="noreferrer" target="_blank">
              <GitFork aria-hidden="true" size={17} />
              austinkimchi/piugame-sdk
            </a>
            <span aria-hidden="true" className="text-[#a0aa98]">/</span>
            <Link className="inline-flex items-center gap-2 text-[#3d4638] hover:text-[#28c950]" href="/privacy">
              <ShieldCheck aria-hidden="true" size={17} />
              Privacy
            </Link>
            <span aria-hidden="true" className="text-[#a0aa98]">/</span>
            <span>&copy; {year} Austin Kim</span>
          </div>
        </div>

        <div className="flex flex-wrap items-start gap-2 lg:justify-end">
          <FooterAdminDashboardLink enabled={showAdminDashboardLink} />
          {(Object.keys(FEEDBACK_CONFIG) as FeedbackKind[]).map((kind) => {
            const config = FEEDBACK_CONFIG[kind];
            const Icon = config.icon;
            return (
              <button
                key={kind}
                className="inline-flex min-h-10 items-center gap-2 border border-[#cfd7c8] bg-white px-3 text-sm font-black text-[#343b30] transition hover:border-[#28c950] hover:bg-[#eef7ed]"
                type="button"
                onClick={() => setOpenKind(kind)}
              >
                <Icon aria-hidden="true" size={16} />
                {config.button}
              </button>
            );
          })}
        </div>
      </div>

      <FeedbackDialog kind={openKind} onClose={() => setOpenKind(null)} />
    </footer>
  );
}

function FeedbackDialog({ kind, onClose }: { kind: FeedbackKind | null; onClose: () => void }) {
  const [scenario, setScenario] = useState("");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [contact, setContact] = useState("");
  const [submitState, setSubmitState] = useState<SubmitState>("idle");
  const [feedbackMessage, setFeedbackMessage] = useState("");
  const config = kind ? FEEDBACK_CONFIG[kind] : null;
  const Icon = config?.icon ?? Mail;
  const pageUrl = useMemo(() => (typeof window === "undefined" ? "" : window.location.href), []);

  function resetAndClose() {
    onClose();
    window.setTimeout(() => {
      setScenario("");
      setSubject("");
      setMessage("");
      setContact("");
      setSubmitState("idle");
      setFeedbackMessage("");
    }, 180);
  }

  async function submitFeedback(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!kind || !config) {
      return;
    }

    setSubmitState("sending");
    setFeedbackMessage("");
    const response = await fetch("/api/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        kind,
        scenario,
        subject,
        message,
        contact,
        pageUrl,
      }),
    });
    const body = (await response.json().catch(() => null)) as { error?: string } | null;

    if (!response.ok) {
      setSubmitState("error");
      setFeedbackMessage(body?.error ?? "Could not send right now.");
      return;
    }

    setSubmitState("sent");
    setFeedbackMessage("Sent. Thank you for helping improve the catalog.");
  }

  return (
    <MotionConfig reducedMotion="user">
      <AnimatePresence>
        {kind && config ? (
          <motion.div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-[#171916]/45 px-4 py-5 backdrop-blur-sm"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          role="dialog"
          aria-modal="true"
          aria-label={config.title}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              resetAndClose();
            }
          }}
        >
            <motion.form
              className="w-full max-w-2xl border border-[#d6ddcf] bg-[#fbfcf7] p-5 shadow-[0_24px_80px_rgba(12,18,10,0.26)]"
              initial={{ opacity: 0, y: 18, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 12, scale: 0.98 }}
              transition={{ type: "spring", stiffness: 280, damping: 28 }}
              onSubmit={submitFeedback}
            >
            <div className="mb-5 flex items-start justify-between gap-4">
              <div>
                <div className="inline-flex items-center gap-2 text-sm font-black uppercase text-[#596153]">
                  <Icon aria-hidden="true" size={17} />
                  {config.title}
                </div>
                <p className="mt-2 text-sm leading-6 text-[#56604e]">{config.intro}</p>
              </div>
              <button
                aria-label="Close feedback form"
                className="inline-flex size-10 shrink-0 items-center justify-center border border-[#cfd7c8] bg-white text-[#343b30] hover:bg-[#eef1e8]"
                type="button"
                onClick={resetAndClose}
              >
                <X aria-hidden="true" size={18} />
              </button>
            </div>

            <div className="grid gap-4">
              <label className="grid gap-2">
                <span className="text-xs font-black uppercase text-[#596153]">Scenario</span>
                <select
                  className="min-h-11 border border-[#cfd7c8] bg-white px-3 text-sm font-bold text-[#171916] outline-none focus:border-[#28c950]"
                  required
                  value={scenario}
                  onChange={(event) => setScenario(event.target.value)}
                >
                  <option value="">Choose one</option>
                  {config.scenarios.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="grid gap-2">
                <span className="text-xs font-black uppercase text-[#596153]">Subject</span>
                <input
                  className="min-h-11 border border-[#cfd7c8] bg-white px-3 text-sm font-bold text-[#171916] outline-none focus:border-[#28c950]"
                  maxLength={120}
                  required
                  value={subject}
                  onChange={(event) => setSubject(event.target.value)}
                  placeholder="Short summary"
                />
              </label>

              <label className="grid gap-2">
                <span className="text-xs font-black uppercase text-[#596153]">Details</span>
                <textarea
                  className="min-h-36 resize-y border border-[#cfd7c8] bg-white p-3 text-sm font-medium text-[#171916] outline-none focus:border-[#28c950]"
                  maxLength={4000}
                  required
                  value={message}
                  onChange={(event) => setMessage(event.target.value)}
                  placeholder={config.placeholder}
                />
              </label>

              <label className="grid gap-2">
                <span className="text-xs font-black uppercase text-[#596153]">Contact</span>
                <input
                  className="min-h-11 border border-[#cfd7c8] bg-white px-3 text-sm font-bold text-[#171916] outline-none focus:border-[#28c950]"
                  maxLength={160}
                  value={contact}
                  onChange={(event) => setContact(event.target.value)}
                  placeholder="Email, GitHub, Discord, or leave blank"
                />
              </label>
            </div>

            <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
              <p className={`text-sm font-bold ${submitState === "error" ? "text-[#e3412f]" : "text-[#66705f]"}`}>
                {feedbackMessage || `${message.length}/4000`}
              </p>
              <button
                className="inline-flex min-h-11 items-center gap-2 bg-[#171916] px-5 text-sm font-black text-white hover:bg-[#28c950] disabled:bg-[#aeb8a5]"
                disabled={submitState === "sending" || submitState === "sent"}
                type="submit"
              >
                <Send aria-hidden="true" size={17} />
                {submitState === "sending" ? "Sending" : submitState === "sent" ? "Sent" : "Send"}
              </button>
            </div>
            </motion.form>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </MotionConfig>
  );
}
