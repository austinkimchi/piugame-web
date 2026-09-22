import assert from "node:assert/strict";
import test from "node:test";

import {
  MOBILE_USER_SNAPSHOT_FENCE_FIELDS,
  mobileUserSnapshotFence,
  performanceProfileSnapshotFence,
} from "../src/lib/mobile-sync-ordering.ts";

test("mobile user updates compare only field-specific source timestamps", () => {
  assert.deepEqual(MOBILE_USER_SNAPSHOT_FENCE_FIELDS, [
    "piuLink.lastMobileSnapshotGeneratedAt",
    "piuLink.lastProfileFetchedAt",
    "preferences.piuGameVersionUpdatedAt",
  ]);

  const generatedAt = new Date("2026-09-22T01:00:00.000Z");
  const fence = mobileUserSnapshotFence(generatedAt);
  assert.equal(fence.$and.length, 3);
  assert.deepEqual(fence.$and[0].$or, [
    { "piuLink.lastMobileSnapshotGeneratedAt": { $exists: false } },
    { "piuLink.lastMobileSnapshotGeneratedAt": null },
    { "piuLink.lastMobileSnapshotGeneratedAt": { $lte: generatedAt } },
  ]);
  assert.equal(Object.hasOwn(fence, "updatedAt"), false);
});

test("legacy profiles fall back to their existing sync and update timestamps", () => {
  const observedAt = new Date("2026-09-22T01:00:00.000Z");

  assert.deepEqual(performanceProfileSnapshotFence(observedAt), {
    $or: [
      { lastSnapshotGeneratedAt: { $lte: observedAt } },
      {
        $and: [
          {
            $or: [
              { lastSnapshotGeneratedAt: { $exists: false } },
              { lastSnapshotGeneratedAt: null },
            ],
          },
          {
            $or: [
              { lastSyncedAt: { $lte: observedAt } },
              {
                $and: [
                  {
                    $or: [
                      { lastSyncedAt: { $exists: false } },
                      { lastSyncedAt: null },
                    ],
                  },
                  { updatedAt: { $lte: observedAt } },
                ],
              },
            ],
          },
        ],
      },
    ],
  });
});
