import assert from "node:assert/strict";
import test from "node:test";

import { countLatestSessionPlays } from "../src/lib/performance-session.ts";

test("counts plays in the newest uninterrupted session", () => {
  const base = new Date("2026-08-18T22:00:00.000Z");
  const minutesEarlier = (minutes: number) => new Date(base.getTime() - minutes * 60_000);

  assert.equal(countLatestSessionPlays([base, minutesEarlier(30), minutesEarlier(119), minutesEarlier(240)]), 3);
});

test("starts a new session when the break is exactly two hours", () => {
  const base = new Date("2026-08-18T22:00:00.000Z");
  const twoHoursEarlier = new Date(base.getTime() - 2 * 60 * 60_000);

  assert.equal(countLatestSessionPlays([base, twoHoursEarlier]), 1);
});
