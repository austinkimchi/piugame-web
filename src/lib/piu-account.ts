import "server-only";

import { PiuClient, type PlayerData } from "@austinkimchi/piugame-sdk";
import { normalizePiuGameVersion } from "@/lib/piu-version";
import type { PiuCatalogVersion } from "@/lib/types";

export async function fetchPiuProfile(args: { piuUsername: string; password: string; version?: PiuCatalogVersion }): Promise<PlayerData> {
  const piuUsername = args.piuUsername.trim();
  if (!piuUsername || !args.password) {
    throw new Error("PIU username and password are required.");
  }

  const client = new PiuClient({ version: normalizePiuGameVersion(args.version) });
  await client.login(piuUsername, args.password);
  return client.getPlayerData(piuUsername);
}

export function piuDisplayName(profile: PlayerData, fallbackUsername: string): string {
  const gameIdTag = profile.gameIdTag?.trim();
  const username = profile.username.trim() || fallbackUsername.trim();
  const gameId = profile.gameId?.trim();
  return gameIdTag || gameId || username;
}
