import assert from "node:assert/strict";
import test from "node:test";

import { EMPTY_RECENT_PLAYS_MESSAGE, shouldTreatRecentPlaysAsEmpty } from "../src/lib/performance-sync-errors.ts";

test("treats the SDK empty recent-play parse error as an empty list when the profile has no plays", () => {
  const error = Object.assign(new Error(EMPTY_RECENT_PLAYS_MESSAGE), {
    code: "PARSE_ERROR",
    parser: "parseRecentPlays",
  });

  assert.equal(shouldTreatRecentPlaysAsEmpty({ profilePlayCount: 0, error }), true);
});

test("does not hide recent-play parser failures for profiles with existing plays", () => {
  const error = Object.assign(new Error(EMPTY_RECENT_PLAYS_MESSAGE), {
    code: "PARSE_ERROR",
    parser: "parseRecentPlays",
  });

  assert.equal(shouldTreatRecentPlaysAsEmpty({ profilePlayCount: 12, error }), false);
});

test("does not assume an unknown profile play count means zero plays", () => {
  const error = Object.assign(new Error(EMPTY_RECENT_PLAYS_MESSAGE), {
    code: "PARSE_ERROR",
    parser: "parseRecentPlays",
  });

  assert.equal(shouldTreatRecentPlaysAsEmpty({ profilePlayCount: null, error }), false);
});

test("does not hide unrelated sync errors", () => {
  const error = Object.assign(new Error("Authentication failed."), {
    code: "AUTHENTICATION_FAILED",
  });

  assert.equal(shouldTreatRecentPlaysAsEmpty({ profilePlayCount: 0, error }), false);
});
