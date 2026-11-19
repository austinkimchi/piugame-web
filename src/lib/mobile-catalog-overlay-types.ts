import type { CatalogChartRecommendations } from "./chart-recommendation.ts";
import type { PiuCatalogVersion } from "./types.ts";

/** Private account data layered onto the selected public catalog snapshot. */
export interface MobileCatalogOverlay {
  schemaVersion: 1;
  version: PiuCatalogVersion;
  favoriteSlugs: string[];
  /** Public song slug -> ordered mode key (all, S, SD, ...) -> chart token. */
  recommendations: CatalogChartRecommendations;
}
