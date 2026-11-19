import type { CatalogFilterOptions } from "./types.ts";

export function catalogFilterOptionsForSelection(
  results: CatalogFilterOptions,
  catalog: CatalogFilterOptions,
  selected: { folders: readonly string[]; series: readonly string[] },
): CatalogFilterOptions {
  // Folder and series selections are OR groups. Keep alternatives available
  // while building either selection, even when results contain only one value.
  return {
    ...results,
    folders: selected.folders.length > 0 ? catalog.folders : results.folders,
    series: selected.series.length > 0 ? catalog.series : results.series,
  };
}
