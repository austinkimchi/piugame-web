import type { PiuCatalogVersion } from "./types.ts";

type AccountPreferenceChange = { performanceAutoRefresh?: boolean; piuGameVersion?: PiuCatalogVersion };
type PreferenceResult = { ok: true } | { ok: false; error: string };

/** Keep transport failures recoverable for both account preference controls. */
export async function requestAccountPreferences(preferences: AccountPreferenceChange, fetcher: typeof fetch = fetch): Promise<PreferenceResult> {
  try {
    const response = await fetcher("/api/account/preferences", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(preferences),
    });
    if (response.ok) return { ok: true };
    const body: unknown = await response.json().catch(() => null);
    const message = body && typeof body === "object" && "error" in body && typeof body.error === "string" ? body.error.trim() : "";
    return { ok: false, error: message || "Could not save preference. Please try again." };
  } catch {
    return { ok: false, error: "Could not save preference. Check your connection and try again." };
  }
}
