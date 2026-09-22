import { type NextRequest, NextResponse } from "next/server";
import { after } from "next/server";

import { getCurrentUser, linkPiuAccount } from "@/lib/auth";
import { PerformanceUserBusyError } from "@/lib/performance-user-lock";
import { fetchPiuProfile } from "@/lib/piu-account";
import { fetchCurrentUserRecentPlays, syncCurrentUserTopPlaysIfDue, syncQueuedAllPlaysBackfillForUser } from "@/lib/performance";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Sign in before linking a PIU account." }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as { piuUsername?: unknown; password?: unknown } | null;
  const piuUsername = String(body?.piuUsername ?? "").trim();
  const password = String(body?.password ?? "");
  if (!piuUsername || !password) {
    return NextResponse.json({ error: "PIU username and password are required." }, { status: 400 });
  }

  try {
    const isFirstPiuLink = !user.piuProfile;
    const profile = await fetchPiuProfile({ piuUsername, password, version: user.preferences.piuGameVersion });
    const linkedUser = await linkPiuAccount(user, { piuUsername, password, profile });
    if (isFirstPiuLink) {
      after(async () => {
        try {
          const fresh = await fetchCurrentUserRecentPlays(user.id);
          await fresh.persist();
          await Promise.all([syncCurrentUserTopPlaysIfDue(user.id), syncQueuedAllPlaysBackfillForUser(user.id)]);
        } catch {
          // The linked account remains usable if its background sync cannot complete.
        }
      });
    }
    return NextResponse.json({ user: linkedUser });
  } catch (error) {
    if (error instanceof PerformanceUserBusyError) {
      return NextResponse.json(
        { error: "PIU performance data is being updated. Try linking again in a moment." },
        { status: 409, headers: { "Retry-After": "2" } },
      );
    }
    return NextResponse.json({ error: "Could not verify that PIU login. Check the username and password, then try again." }, { status: 400 });
  }
}
