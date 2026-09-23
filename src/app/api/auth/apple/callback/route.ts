import { cookies } from "next/headers";
import { type NextRequest, NextResponse } from "next/server";

import { SESSION_COOKIE_NAME, createSession, sessionCookieOptions, upsertAppleUser } from "@/lib/auth";
import {
  APPLE_OAUTH_STATE_COOKIE_NAME,
  appleOAuthOrigin,
  exchangeAppleWebCode,
  verifyAppleOAuthState,
} from "@/lib/apple-auth";
import { publicRequestOrigin } from "@/lib/oauth-origin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const origin = appleOAuthOrigin(publicRequestOrigin(request.headers, request.nextUrl.origin));
  const cookieStore = await cookies();
  const expectedState = cookieStore.get(APPLE_OAUTH_STATE_COOKIE_NAME)?.value;
  cookieStore.delete(APPLE_OAUTH_STATE_COOKIE_NAME);
  try {
    const form = await request.formData();
    if (form.get("error")) {
      return authFailure(origin);
    }
    const stateValue = form.get("state");
    const code = form.get("code");
    if (
      typeof stateValue !== "string" ||
      !expectedState ||
      stateValue !== expectedState ||
      typeof code !== "string" ||
      code.length > 2_048
    ) {
      return authFailure(origin);
    }

    const state = verifyAppleOAuthState(stateValue);
    const identity = await exchangeAppleWebCode({ code, origin, nonce: state.nonce });
    const name = appleDisplayName(form.get("user"));
    const user = await upsertAppleUser(
      {
        appleId: identity.appleId,
        email: identity.email,
        emailVerified: identity.emailVerified,
        name,
      },
      state.linkUserId ?? undefined,
    );
    const sessionToken = await createSession(user._id);
    cookieStore.set(SESSION_COOKIE_NAME, sessionToken, sessionCookieOptions());
    return NextResponse.redirect(new URL(state.next, origin), { status: 303 });
  } catch {
    return authFailure(origin);
  }
}

function appleDisplayName(value: FormDataEntryValue | null): string | null {
  if (typeof value !== "string" || value.length > 4_000) {
    return null;
  }
  try {
    const parsed = JSON.parse(value) as { name?: { firstName?: unknown; lastName?: unknown } };
    const parts = [parsed.name?.firstName, parsed.name?.lastName]
      .filter((part): part is string => typeof part === "string")
      .map((part) => part.replace(/\s+/g, " ").trim())
      .filter(Boolean);
    return parts.join(" ").slice(0, 120) || null;
  } catch {
    return null;
  }
}

function authFailure(origin: string) {
  return NextResponse.redirect(new URL("/?auth=failed", origin), { status: 303 });
}
