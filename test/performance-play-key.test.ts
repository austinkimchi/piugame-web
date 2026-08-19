import assert from "node:assert/strict";
import test from "node:test";

import { performancePlayKey } from "../src/lib/performance-play-key.ts";

test("uses the normalized timestamp as the recent-play identity key", () => {
  const timestamp = new Date("2026-08-15T06:30:00.000Z");
  const first = performancePlayKey({ playedAt: timestamp });
  const repeated = performancePlayKey({ playedAt: new Date(timestamp) });

  assert.equal(first, repeated);
  assert.equal(first, "2026-08-15T06:30:00.000Z");
});
