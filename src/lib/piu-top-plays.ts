import type { PiuClient, TopPlay, TopPlayMode } from "@austinkimchi/piugame-sdk";

import type { PiuCatalogVersion } from "@/lib/types";

type TopPlaysClient = Pick<PiuClient, "getTopPlays">;

export async function fetchPumbilityTopPlays(
  client: TopPlaysClient,
  username: string,
  version: PiuCatalogVersion,
): Promise<TopPlay[]> {
  if (version !== "phoenix2") {
    return client.getTopPlays(username);
  }

  const modes = ["single", "double"] satisfies TopPlayMode[];
  const modePlays = await Promise.all(
    modes.map((mode) => client.getTopPlays(username, mode)),
  );
  return rankPumbilityTopPlays(modePlays.flat());
}

export function rankPumbilityTopPlays(plays: TopPlay[]): TopPlay[] {
  return [...plays]
    .sort((left, right) => {
      const leftScore = left.score ?? Number.NEGATIVE_INFINITY;
      const rightScore = right.score ?? Number.NEGATIVE_INFINITY;
      return rightScore - leftScore || left.rank - right.rank;
    })
    .map((play, index) => ({ ...play, rank: index + 1 }));
}
