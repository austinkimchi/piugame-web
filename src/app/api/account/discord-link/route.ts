import { NextResponse } from "next/server";

import { getCurrentUser, unlinkDiscordAccount } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Sign in before disconnecting Discord." }, { status: 401 });
  }

  try {
    const updatedUser = await unlinkDiscordAccount(user);
    return NextResponse.json({ user: updatedUser });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not disconnect Discord." }, { status: 400 });
  }
}
