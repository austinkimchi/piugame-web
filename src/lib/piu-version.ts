import type { PiuCatalogVersion } from "@/lib/types";

export const DEFAULT_PIU_GAME_VERSION: PiuCatalogVersion = "phoenix";

export function normalizePiuGameVersion(value: unknown): PiuCatalogVersion {
  return value === "phoenix2" ? "phoenix2" : DEFAULT_PIU_GAME_VERSION;
}

export function isPiuGameVersion(value: unknown): value is PiuCatalogVersion {
  return value === "phoenix" || value === "phoenix2";
}
