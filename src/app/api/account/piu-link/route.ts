import { type NextRequest, NextResponse } from "next/server";

import { getCurrentUser, linkPiuAccount } from "@/lib/auth";
import { fetchPiuProfile } from "@/lib/piu-account";

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
    const profile = await fetchPiuProfile({ piuUsername, password });
    const linkedUser = await linkPiuAccount(user, { piuUsername, password, profile });
    return NextResponse.json({ user: linkedUser });
  } catch {
    return NextResponse.json({ error: "Could not verify that PIU login. Check the username and password, then try again." }, { status: 400 });
  }
}
