import assert from "node:assert/strict";
import test from "node:test";

import { songMatchesChartFilters } from "../src/lib/song-chart-filters.ts";

test("AND level filters are evaluated across the song's full chart list", () => {
  assert.equal(songMatchesChartFilters({ chartSummary: ["S16", "S17"] }, ["16", "17"], ["singles"], "and"), true);
  assert.equal(songMatchesChartFilters({ chartSummary: ["S16"] }, ["16", "17"], ["singles"], "and"), false);
});

test("a recommended token can match one member of a multi-level filter", () => {
  assert.equal(songMatchesChartFilters({ chartSummary: ["S16"] }, ["16", "17"], ["singles"], "or"), true);
});
