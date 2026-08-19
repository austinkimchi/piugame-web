import assert from "node:assert/strict";
import test from "node:test";

import { chartCommunityKey } from "../src/lib/chart-community.ts";

const song = {
  chartLinks: [{ id: "phoenix:s15", tokens: { phoenix: "S15", phoenix2: "S16" } }],
};

test("links changed chart tokens across Phoenix versions", () => {
  assert.equal(chartCommunityKey(song, "phoenix", "S15"), "phoenix:s15");
  assert.equal(chartCommunityKey(song, "phoenix2", "S16"), "phoenix:s15");
});

test("keeps unmapped chart tokens version-specific", () => {
  assert.equal(chartCommunityKey(song, "phoenix", "D20"), "phoenix:D20");
  assert.equal(chartCommunityKey(song, "phoenix2", "D20"), "phoenix2:D20");
});
