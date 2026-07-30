import { type NextRequest, NextResponse } from "next/server";

import { getCurrentUser, searchUsersForAdmin, setUserModeratorRole } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  }

  try {
    const query = request.nextUrl.searchParams.get("q") ?? "";
    return NextResponse.json(
      { users: await searchUsersForAdmin(user, query) },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Admin action failed." }, { status: 403 });
  }
}

export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as { userId?: string; moderator?: boolean; notes?: string } | null;
  try {
    await setUserModeratorRole(user, body?.userId ?? "", body?.moderator === true, body?.notes);
    return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Admin action failed." }, { status: 400 });
  }
}
