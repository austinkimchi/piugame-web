import { type NextRequest, NextResponse } from "next/server";

import { getCurrentUser, setUsername } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as { username?: string } | null;
  try {
    return NextResponse.json(
      { user: await setUsername(user, body?.username ?? "") },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not save username.";
    const status = /duplicate|E11000/i.test(message) ? 409 : 400;
    return NextResponse.json({ error: status === 409 ? "That username is already taken." : message }, { status });
  }
}
