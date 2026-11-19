import assert from "node:assert/strict";
import test from "node:test";

import { catalogFilterOptionsForSelection } from "../src/lib/catalog-filter-options.ts";

const catalog = {
  folders: ["K-Pop", "ORIGINAL", "World Music"],
  series: ["XX", "PHOENIX", "PHOENIX 2"],
  levels: ["1", "17", "25"],
  charts: ["singles", "doubles", "co-op"],
};
const originalResults = {
  folders: ["ORIGINAL"],
  series: ["PHOENIX 2"],
  levels: ["17"],
  charts: ["singles"],
};

test("a selected folder leaves other folders available for an OR selection", () => {
  const firstSelection = catalogFilterOptionsForSelection(originalResults, catalog, { folders: ["ORIGINAL"], series: [] });
  assert.deepEqual(firstSelection.folders, ["K-Pop", "ORIGINAL", "World Music"]);
  assert.deepEqual(firstSelection.series, ["PHOENIX 2"]);

  const secondSelection = catalogFilterOptionsForSelection(
    { ...originalResults, folders: ["K-Pop", "ORIGINAL"] },
    catalog,
    { folders: ["ORIGINAL", "K-Pop"], series: [] },
  );
  assert.ok(secondSelection.folders.includes("World Music"));
});

test("clearing folder selection restores options narrowed by the current search", () => {
  const options = catalogFilterOptionsForSelection(originalResults, catalog, { folders: [], series: [] });
  assert.deepEqual(options, originalResults);
});

test("folder and series alternatives remain available without expanding chart or level options", () => {
  const options = catalogFilterOptionsForSelection(originalResults, catalog, { folders: ["ORIGINAL"], series: ["PHOENIX 2"] });
  assert.deepEqual(options, { ...originalResults, folders: catalog.folders, series: catalog.series });
});

test("a zero-result combination keeps selected folder and series controls recoverable", () => {
  const empty = { folders: [], series: [], levels: [], charts: [] };
  const options = catalogFilterOptionsForSelection(empty, catalog, { folders: ["ORIGINAL"], series: ["XX"] });
  assert.deepEqual(options, { ...empty, folders: catalog.folders, series: catalog.series });
});
