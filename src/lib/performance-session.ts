const SESSION_BREAK_MS = 2 * 60 * 60 * 1000;

export function startsNewSession(previous: Date, next: Date): boolean {
  return previous.getTime() - next.getTime() >= SESSION_BREAK_MS;
}

/** Counts the consecutive newest plays that belong to the current play session. */
export function countLatestSessionPlays(playedAtValues: Iterable<Date | null>): number {
  let count = 0;
  let previous: Date | null = null;

  for (const playedAt of playedAtValues) {
    if (!playedAt || Number.isNaN(playedAt.getTime())) {
      continue;
    }

    if (previous && startsNewSession(previous, playedAt)) {
      break;
    }

    count += 1;
    previous = playedAt;
  }

  return count;
}
