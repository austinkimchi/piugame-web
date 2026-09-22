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
