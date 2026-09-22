export const MOBILE_USER_SNAPSHOT_FENCE_FIELDS = [
  "piuLink.lastMobileSnapshotGeneratedAt",
  "piuLink.lastProfileFetchedAt",
  "preferences.piuGameVersionUpdatedAt",
] as const;

export function mobileUserSnapshotFence(generatedAt: Date) {
  return {
    $and: MOBILE_USER_SNAPSHOT_FENCE_FIELDS.map((field) => ({
      $or: [
        { [field]: { $exists: false } },
        { [field]: null },
        { [field]: { $lte: generatedAt } },
      ],
    })),
  };
}

export function performanceProfileSnapshotFence(observedAt: Date) {
  const missingSnapshotTimestamp = {
    $or: [
      { lastSnapshotGeneratedAt: { $exists: false } },
      { lastSnapshotGeneratedAt: null },
    ],
  };
  const missingLastSyncedAt = {
    $or: [
      { lastSyncedAt: { $exists: false } },
      { lastSyncedAt: null },
    ],
  };

  return {
    $or: [
      { lastSnapshotGeneratedAt: { $lte: observedAt } },
      {
        $and: [
          missingSnapshotTimestamp,
          {
            $or: [
              { lastSyncedAt: { $lte: observedAt } },
              {
                $and: [
                  missingLastSyncedAt,
                  { updatedAt: { $lte: observedAt } },
                ],
              },
            ],
          },
        ],
      },
    ],
  };
}
