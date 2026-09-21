import type { PiuCatalogVersion, PiuSeriesId } from "@/lib/types";

export const DEFAULT_PIU_GAME_VERSION: PiuCatalogVersion = "phoenix";

export function normalizePiuGameVersion(value: unknown): PiuCatalogVersion {
  return value === "phoenix2" ? "phoenix2" : DEFAULT_PIU_GAME_VERSION;
}

export function isPiuGameVersion(value: unknown): value is PiuCatalogVersion {
  return value === "phoenix" || value === "phoenix2";
}

export function performanceVersionForCatalog(catalogVersion: PiuSeriesId, removedFromVersion?: PiuSeriesId): PiuCatalogVersion {
  return catalogVersion === "phoenix" || removedFromVersion === "phoenix2" ? "phoenix" : "phoenix2";
}
