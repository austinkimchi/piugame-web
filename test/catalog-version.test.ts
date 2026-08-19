import assert from "node:assert/strict";
import test from "node:test";

import { DEFAULT_CATALOG_SERIES, piuSeriesFromSlug, sortPiuSeries } from "../src/lib/catalog-version.ts";

test("defaults the website catalog to Phoenix 2", () => {
  assert.equal(DEFAULT_CATALOG_SERIES, "phoenix2");
});

test("parses supported dedicated catalog route slugs", () => {
  assert.equal(piuSeriesFromSlug("phoenix-2")?.id, "phoenix2");
  assert.equal(piuSeriesFromSlug("zero-to-1st")?.id, "zero-1st");
  assert.equal(piuSeriesFromSlug("unknown"), null);
});

test("sorts catalog series newest first", () => {
  assert.deepEqual(sortPiuSeries(["prime", "phoenix2", "xx", "phoenix"]), ["phoenix2", "phoenix", "xx", "prime"]);
});
