import { NextResponse } from "next/server";

import { AccountWriteUnavailableError } from "@/lib/account-write-fence";
import { getUserById, setSongSaved } from "@/lib/auth";
import { getSongBySlug } from "@/lib/catalog";
import { parseMobileFavoriteUpdate, MobileFavoriteValidationError } from "@/lib/mobile-favorite-schema";
import { authenticateMobileAccessToken } from "@/lib/mobile-auth";
import { bearerTokenFromAuthorization } from "@/lib/mobile-auth-core";
import { PerformanceUserBusyError } from "@/lib/performance-user-lock";
import { checkRateLimit } from "@/lib/rate-limit";
import { readRequestText, RequestBodyTooLargeError } from "@/lib/request-body";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_FAVORITE_REQUEST_BYTES = 1024;

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const accessToken = bearerTokenFromAuthorization(request.headers.get("authorization"));
  const identity = await authenticateMobileAccessToken(accessToken);
  if (!identity) {
    return errorResponse("invalid_token", 401);
  }
  if (!checkRateLimit(`mobile-favorite:${identity.userId}`)) {
    return NextResponse.json(
      { error: "rate_limited" },
      { status: 429, headers: { ...noStoreHeaders(), "Retry-After": "60" } },
    );
  }

  const user = await getUserById(identity.userId);
  if (!user) {
    return errorResponse("invalid_token", 401);
  }

  try {
    const payload = parseMobileFavoriteUpdate(await jsonBody(request));
    const { slug } = await params;
    const song = await getSongBySlug(slug, payload.version);
    if (!song || !song.supportedVersions.includes(payload.version)) {
      return errorResponse("song_not_found", 404);
    }

    await setSongSaved(user, song, payload.saved);
    return NextResponse.json(
      { slug: song.slug, isFavorite: payload.saved },
      { headers: noStoreHeaders() },
    );
  } catch (error) {
    if (error instanceof MobileFavoriteValidationError) {
      return NextResponse.json(
        { error: "invalid_payload", message: error.message },
        { status: 422, headers: noStoreHeaders() },
      );
    }
    if (error instanceof AccountWriteUnavailableError) {
      return errorResponse("account_not_found", 404);
    }
    if (error instanceof PerformanceUserBusyError) {
      return NextResponse.json(
        { error: "account_busy" },
        { status: 409, headers: { ...noStoreHeaders(), "Retry-After": "2" } },
      );
    }
    console.error("Mobile favorite update failed.", error);
    return errorResponse("favorite_update_failed", 500);
  }
}

async function jsonBody(request: Request): Promise<unknown> {
  if (!request.headers.get("content-type")?.toLowerCase().includes("application/json")) {
    throw new MobileFavoriteValidationError("Expected application/json.");
  }

  let text: string;
  try {
    text = await readRequestText(request, MAX_FAVORITE_REQUEST_BYTES);
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      throw new MobileFavoriteValidationError("Payload is too large.");
    }
    throw error;
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new MobileFavoriteValidationError("Malformed JSON.");
  }
}

function errorResponse(error: string, status: number) {
  return NextResponse.json({ error }, { status, headers: noStoreHeaders() });
}

function noStoreHeaders() {
  return { "Cache-Control": "private, no-store", Pragma: "no-cache" };
}
