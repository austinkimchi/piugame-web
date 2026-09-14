export function canLoadMoreSongs({
  appendInFlight,
  loading,
  nextCursor,
}: {
  appendInFlight: boolean;
  loading: boolean;
  nextCursor: string | null;
}): boolean {
  return Boolean(nextCursor) && !loading && !appendInFlight;
}
