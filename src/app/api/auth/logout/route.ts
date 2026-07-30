import { cookies } from "next/headers";
import { type NextRequest, NextResponse } from "next/server";

import { SESSION_COOKIE_NAME, deleteCurrentSession } from "@/lib/auth";
import { googleOAuthOrigin } from "@/lib/google-oauth";
import { publicRequestOrigin } from "@/lib/oauth-origin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  await deleteCurrentSession();
  (await cookies()).delete(SESSION_COOKIE_NAME);
  const publicOrigin = googleOAuthOrigin(publicRequestOrigin(request.headers, request.nextUrl.origin));
  return NextResponse.redirect(new URL("/", publicOrigin), { status: 303 });
}
