import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth";
import { normalizePiuGameVersion } from "@/lib/piu-version";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "authentication_required" }, { status: 401, headers: noStoreHeaders() });
  }
  if (!user.piuProfile?.piuUsername) {
    return NextResponse.json({ error: "piu_account_not_linked" }, { status: 409, headers: noStoreHeaders() });
  }

  return NextResponse.json(
    {
      piuUsername: user.piuProfile.piuUsername,
      piuDisplayName: user.piuProfile.displayName,
      piuVersion: normalizePiuGameVersion(user.preferences.piuGameVersion),
    },
    { headers: noStoreHeaders() },
  );
}

function noStoreHeaders() {
  return { "Cache-Control": "private, no-store" };
}
