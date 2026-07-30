"use client";

import { useEffect, useState } from "react";

export type AdminViewMode = "admin" | "regular";

const STORAGE_KEY = "mypiu-admin-view-mode";
const CHANGE_EVENT = "mypiu-admin-view-mode-change";

function readMode(): AdminViewMode {
  if (typeof window === "undefined") {
    return "admin";
  }

  return window.localStorage.getItem(STORAGE_KEY) === "regular" ? "regular" : "admin";
}

function applyMode(mode: AdminViewMode) {
  document.documentElement.dataset.adminViewMode = mode;
}

export function setStoredAdminViewMode(mode: AdminViewMode) {
  window.localStorage.setItem(STORAGE_KEY, mode);
  applyMode(mode);
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function useAdminViewMode() {
  const [mode, setMode] = useState<AdminViewMode>("admin");

  useEffect(() => {
    const syncMode = () => {
      const nextMode = readMode();
      setMode(nextMode);
      applyMode(nextMode);
    };

    syncMode();
    window.addEventListener("storage", syncMode);
    window.addEventListener(CHANGE_EVENT, syncMode);

    return () => {
      window.removeEventListener("storage", syncMode);
      window.removeEventListener(CHANGE_EVENT, syncMode);
    };
  }, []);

  return {
    mode,
    setMode: setStoredAdminViewMode,
    viewingAsRegular: mode === "regular",
  };
}
