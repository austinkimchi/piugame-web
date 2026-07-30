import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { SESSION_COOKIE_NAME, deleteCurrentSession } from "@/lib/auth";
import { googleOAuthOrigin } from "@/lib/google-oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  await deleteCurrentSession();
  (await cookies()).delete(SESSION_COOKIE_NAME);
  return NextResponse.redirect(new URL("/", googleOAuthOrigin(new URL(request.url).origin)), { status: 303 });
}
