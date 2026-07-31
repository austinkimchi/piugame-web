import { NextResponse } from "next/server";

import { getCurrentUser, updateUserPreferences } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as {
    songDetailCompactView?: boolean;
    songPreviewMuted?: boolean;
    songPreviewVolume?: number;
  } | null;
  const preferences = {
    ...(typeof body?.songDetailCompactView === "boolean" ? { songDetailCompactView: body.songDetailCompactView } : {}),
    ...(typeof body?.songPreviewMuted === "boolean" ? { songPreviewMuted: body.songPreviewMuted } : {}),
    ...(typeof body?.songPreviewVolume === "number" && Number.isFinite(body.songPreviewVolume) ? { songPreviewVolume: body.songPreviewVolume } : {}),
  };

  if (Object.keys(preferences).length === 0) {
    return NextResponse.json({ error: "Missing preference." }, { status: 400 });
  }

  try {
    const updatedUser = await updateUserPreferences(user, preferences);
    return NextResponse.json(
      { preferences: updatedUser.preferences },
      {
        headers: { "Cache-Control": "private, no-store" },
      },
    );
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not save preference." }, { status: 400 });
  }
}
