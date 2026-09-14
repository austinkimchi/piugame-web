import type { PiuClient } from "@austinkimchi/piugame-sdk";
import { load } from "cheerio";

interface AuthenticatedPiuClient {
  authenticatedRequest(
    username: string,
    request: {
      method: "GET";
      path: string;
      redirect: "manual";
      skipEnsureAuthenticated: true;
    },
  ): Promise<{ body: string }>;
}

export function parsePumbilityScore(html: string): number | null {
  const $ = load(html);
  const scoreText = $(
    ".pumbility_total_wrap .score, .pumbility_total_wrap .inn .t2, .pumbility_total_wrap .in_bg1 .t2",
  )
    .first()
    .text();
  const match = /-?\d[\d,]*(?:\.\d+)?/.exec(scoreText);
  if (!match) {
    return null;
  }

  const score = Number(match[0].replaceAll(",", ""));
  return Number.isFinite(score) ? score : null;
}

export async function fetchPumbilityScore(client: PiuClient, username: string): Promise<number | null> {
  try {
    // SDK 1.3.x does not expose its authenticated transport, but using the same
    // session avoids storing or forwarding PIUGAME credentials a second time.
    const authenticatedClient = client as unknown as AuthenticatedPiuClient;
    const response = await authenticatedClient.authenticatedRequest(username, {
      method: "GET",
      path: "/my_page/pumbility.php",
      redirect: "manual",
      skipEnsureAuthenticated: true,
    });
    return parsePumbilityScore(response.body);
  } catch {
    return null;
  }
}
