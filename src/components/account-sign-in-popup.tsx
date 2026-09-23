"use client";

import { LogIn, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";

interface AccountSignInPopupProps {
  appleReady: boolean;
  googleReady: boolean;
  discordReady: boolean;
}

export function AccountSignInPopup({ appleReady, googleReady, discordReady }: AccountSignInPopupProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }

    function handlePointerDown(event: PointerEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <motion.button
        aria-expanded={open}
        aria-haspopup="dialog"
        className="inline-flex h-12 w-12 items-center justify-center border border-[#cdd5c5] bg-white/78 text-[#171916] shadow-[0_14px_34px_rgba(29,35,24,0.08)] backdrop-blur transition hover:border-[#28c950] hover:bg-white hover:text-[#28c950]"
        title="Sign in"
        type="button"
        whileHover={{ y: -2, scale: 1.04 }}
        whileTap={{ scale: 0.94 }}
        onClick={() => setOpen((value) => !value)}
      >
        <LogIn aria-hidden="true" size={18} />
      </motion.button>

      <AnimatePresence>
        {open ? (
          <motion.div
            aria-label="Sign in options"
            className="absolute right-0 top-[calc(100%+0.75rem)] z-40 w-[min(19rem,calc(100vw-2.5rem))] border border-[#d8dfd1] bg-white p-3 shadow-[0_24px_70px_rgba(18,23,16,0.18)]"
            initial={{ opacity: 0, y: -8, scale: 0.96, filter: "blur(6px)" }}
            animate={{ opacity: 1, y: 0, scale: 1, filter: "blur(0px)" }}
            exit={{ opacity: 0, y: -8, scale: 0.97, filter: "blur(6px)" }}
            role="dialog"
            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
          >
            <div className="mb-3 flex items-center justify-between gap-3">
              <p className="text-sm font-black uppercase text-[#596153]">Sign in</p>
              <button
                aria-label="Close sign in popup"
                className="inline-flex h-8 w-8 items-center justify-center text-[#66705f] transition hover:bg-[#f7f8f2] hover:text-[#171916]"
                type="button"
                onClick={() => setOpen(false)}
              >
                <X aria-hidden="true" size={16} />
              </button>
            </div>
            <div className="grid gap-2">
              <ProviderLink href={appleReady ? "/api/auth/apple/login?next=/" : "#"} ready={appleReady} provider="apple">
                Continue with Apple
              </ProviderLink>
              <ProviderLink href={googleReady ? "/api/auth/google/login?next=/" : "#"} ready={googleReady} provider="google">
                Sign in with Google
              </ProviderLink>
              <ProviderLink href={discordReady ? "/api/auth/discord/login?next=/" : "#"} ready={discordReady} provider="discord">
                Sign in with Discord
              </ProviderLink>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

function ProviderLink({ children, href, provider, ready }: { children: string; href: string; provider: "apple" | "google" | "discord"; ready: boolean }) {
  const google = provider === "google";
  const apple = provider === "apple";

  return (
    <a
      aria-disabled={!ready}
      className={`inline-flex min-h-12 items-center gap-3 border px-3 text-sm font-black transition ${
        apple
          ? "border-black bg-black text-white hover:bg-[#242424]"
          : google
          ? "border-[#4285f4] bg-white text-[#174ea6] hover:bg-[#eef4ff]"
          : "border-[#171916] bg-[#171916] text-white hover:bg-[#343b30]"
      } ${ready ? "" : "pointer-events-none opacity-55"}`}
      href={href}
    >
      {apple ? <AppleMark /> : google ? <GoogleMark /> : <DiscordMark />}
      <span>{children}</span>
    </a>
  );
}

function AppleMark() {
  return <span aria-hidden="true" className="grid h-7 w-7 place-items-center font-sans text-[1.55rem] leading-none"></span>;
}

function GoogleMark() {
  return (
    <span className="grid h-7 w-7 place-items-center rounded-full bg-white shadow-[inset_0_0_0_1px_rgba(66,133,244,0.28)]">
      <svg aria-hidden="true" height="18" viewBox="0 0 18 18" width="18">
        <path d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62z" fill="#4285f4" />
        <path d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.35 0-4.34-1.58-5.05-3.72H.94v2.34A9 9 0 0 0 9 18z" fill="#34a853" />
        <path d="M3.95 10.7A5.41 5.41 0 0 1 3.67 9c0-.59.1-1.16.28-1.7V4.96H.94A9 9 0 0 0 0 9c0 1.45.34 2.82.94 4.04l3.01-2.34z" fill="#fbbc05" />
        <path d="M9 3.58c1.32 0 2.5.45 3.43 1.35l2.59-2.59A8.68 8.68 0 0 0 9 0 9 9 0 0 0 .94 4.96L3.95 7.3C4.66 5.16 6.65 3.58 9 3.58z" fill="#ea4335" />
      </svg>
    </span>
  );
}

function DiscordMark() {
  return (
    <svg aria-hidden="true" className="h-7 w-7 shrink-0" fill="currentColor" viewBox="0 0 24 24">
      <path d="M20.32 4.37A19.8 19.8 0 0 0 15.37 3c-.21.38-.46.88-.63 1.28a18.27 18.27 0 0 0-5.47 0A12.64 12.64 0 0 0 8.63 3a19.74 19.74 0 0 0-4.95 1.37C.53 9.04-.32 13.58.11 18.06a19.9 19.9 0 0 0 6.07 3.07c.49-.67.93-1.38 1.31-2.11a12.7 12.7 0 0 1-2.07-.98c.17-.13.34-.26.51-.4 3.98 1.87 8.31 1.87 12.24 0 .16.14.33.27.51.4-.66.39-1.35.71-2.07.98.38.74.82 1.45 1.31 2.11a19.87 19.87 0 0 0 6.07-3.07c.5-5.19-.85-9.69-3.69-13.69ZM8.02 15.33c-1.2 0-2.18-1.09-2.18-2.43 0-1.34.96-2.43 2.18-2.43 1.22 0 2.2 1.1 2.18 2.43 0 1.34-.96 2.43-2.18 2.43Zm7.96 0c-1.2 0-2.18-1.09-2.18-2.43 0-1.34.96-2.43 2.18-2.43 1.22 0 2.2 1.1 2.18 2.43 0 1.34-.96 2.43-2.18 2.43Z" />
    </svg>
  );
}
