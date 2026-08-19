"use client";

const MANUAL_UPLOADS_STORAGE_KEY = "mypiu-admin-view-manual-uploads";
const MANUAL_UPLOADS_CHANGE_EVENT = "mypiu-admin-view-manual-uploads-change";
let settingsPanel: HTMLDivElement | null = null;

export function readManualUploadsVisible(): boolean {
  if (typeof window === "undefined") {
    return false;
  }

  return window.localStorage.getItem(MANUAL_UPLOADS_STORAGE_KEY) === "true";
}

export function setStoredManualUploadsVisible(visible: boolean) {
  window.localStorage.setItem(MANUAL_UPLOADS_STORAGE_KEY, visible ? "true" : "false");
  window.dispatchEvent(new Event(MANUAL_UPLOADS_CHANGE_EVENT));
}

export function subscribeManualUploadsVisible(onChange: (visible: boolean) => void): () => void {
  const syncVisible = () => {
    onChange(readManualUploadsVisible());
  };

  syncVisible();
  window.addEventListener("storage", syncVisible);
  window.addEventListener(MANUAL_UPLOADS_CHANGE_EVENT, syncVisible);

  return () => {
    window.removeEventListener("storage", syncVisible);
    window.removeEventListener(MANUAL_UPLOADS_CHANGE_EVENT, syncVisible);
  };
}

export function toggleAdminSettingsPanel(anchor: HTMLElement) {
  if (settingsPanel) {
    closeAdminSettingsPanel();
    return;
  }

  const anchorRect = anchor.getBoundingClientRect();
  const panel = document.createElement("div");
  panel.className = "fixed z-50 w-64 border border-[#cdd5c5] bg-white p-3 text-[#171916] shadow-[0_18px_46px_rgba(29,35,24,0.16)]";
  panel.style.top = `${Math.min(anchorRect.bottom + 8, window.innerHeight - 148)}px`;
  panel.style.right = `${Math.max(window.innerWidth - anchorRect.right, 12)}px`;

  const header = document.createElement("div");
  header.className = "mb-3 flex items-center justify-between gap-3";

  const title = document.createElement("h2");
  title.className = "text-sm font-black uppercase";
  title.textContent = "Admin Settings";

  const closeButton = document.createElement("button");
  closeButton.ariaLabel = "Close admin settings";
  closeButton.className = "inline-flex h-8 w-8 items-center justify-center text-[#66705f] hover:bg-[#eef1e8] hover:text-[#171916]";
  closeButton.type = "button";
  closeButton.textContent = "x";
  closeButton.addEventListener("click", closeAdminSettingsPanel);

  header.append(title, closeButton);

  const label = document.createElement("label");
  label.className = "flex cursor-pointer items-start gap-3 text-sm font-bold text-[#343b30]";

  const checkbox = document.createElement("input");
  checkbox.checked = readManualUploadsVisible();
  checkbox.className = "mt-1 h-4 w-4 accent-[#e3412f]";
  checkbox.type = "checkbox";
  checkbox.addEventListener("change", () => {
    setStoredManualUploadsVisible(checkbox.checked);
  });

  const labelText = document.createElement("span");
  labelText.textContent = "View manual song uploads";

  label.append(checkbox, labelText);
  panel.append(header, label);
  document.body.append(panel);
  settingsPanel = panel;

  window.setTimeout(() => {
    document.addEventListener("pointerdown", closeAdminSettingsPanelOnOutsidePointer);
    document.addEventListener("keydown", closeAdminSettingsPanelOnEscape);
  }, 0);
}

function closeAdminSettingsPanel() {
  settingsPanel?.remove();
  settingsPanel = null;
  document.removeEventListener("pointerdown", closeAdminSettingsPanelOnOutsidePointer);
  document.removeEventListener("keydown", closeAdminSettingsPanelOnEscape);
}

function closeAdminSettingsPanelOnOutsidePointer(event: PointerEvent) {
  if (settingsPanel && !settingsPanel.contains(event.target as Node)) {
    closeAdminSettingsPanel();
  }
}

function closeAdminSettingsPanelOnEscape(event: KeyboardEvent) {
  if (event.key === "Escape") {
    closeAdminSettingsPanel();
  }
}
