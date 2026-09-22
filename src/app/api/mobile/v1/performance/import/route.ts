import { NextResponse } from "next/server";

import { getCurrentUserId } from "@/lib/auth";
import { bearerTokenFromAuthorization } from "@/lib/mobile-auth-core";
import { authenticateMobileAccessToken } from "@/lib/mobile-auth";
import {
  MobilePerformanceImportError,
} from "@/lib/performance";
import {
  claimMobileSyncRateLimit,
  importIdempotentMobilePerformance,
  MobileSyncIdempotencyConflictError,
  MobileSyncInProgressError,
} from "@/lib/mobile-sync";
import { MobileSyncValidationError, parseMobilePerformanceImport } from "@/lib/mobile-sync-schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_IMPORT_BYTES = 256 * 1024;

export async function POST(request: Request) {
  try {
    const authorization = request.headers.get("authorization");
    const accessToken = bearerTokenFromAuthorization(authorization);
    const mobileIdentity = accessToken ? await authenticateMobileAccessToken(accessToken) : null;

    if (authorization && !mobileIdentity) {
      return errorResponse("invalid_token", 401);
    }

    const sessionUserId = mobileIdentity ? null : await getCurrentUserId();
    const userId = mobileIdentity?.userId ?? sessionUserId;
    if (!userId) {
      return errorResponse("authentication_required", 401);
    }

    const payload = parseMobilePerformanceImport(await jsonBody(request));

    if (mobileIdentity) {
      if (payload.installationId !== mobileIdentity.installationId || payload.source !== mobileIdentity.platform) {
        return errorResponse("client_identity_mismatch", 403);
      }
    } else if (payload.source !== "browser-extension") {
      return errorResponse("mobile_token_required", 401);
    }

    if (!(await claimMobileSyncRateLimit(userId, payload.installationId))) {
      return NextResponse.json(
        { error: "rate_limited" },
        { status: 429, headers: { ...noStoreHeaders(), "Retry-After": "60" } },
      );
    }

    const result = await importIdempotentMobilePerformance(userId, payload);
    return NextResponse.json(result, {
      status: result.duplicateRequest ? 200 : 201,
      headers: noStoreHeaders(),
    });
  } catch (error) {
    if (error instanceof MobileSyncValidationError) {
      return NextResponse.json(
        { error: "invalid_payload", field: error.field, message: error.message },
        { status: 422, headers: noStoreHeaders() },
      );
    }
    if (error instanceof MobileSyncInProgressError) {
      return NextResponse.json(
        { error: "import_in_progress" },
        { status: 409, headers: { ...noStoreHeaders(), "Retry-After": "2" } },
      );
    }
    if (error instanceof MobileSyncIdempotencyConflictError) {
      return errorResponse("idempotency_conflict", 409);
    }
    if (error instanceof MobilePerformanceImportError) {
      const status = error.code === "account_not_found" ? 404 : error.code === "piu_username_mismatch" ? 403 : 409;
      return errorResponse(error.code, status);
    }
    return errorResponse("import_failed", 500);
  }
}

async function jsonBody(request: Request): Promise<unknown> {
  if (!request.headers.get("content-type")?.toLowerCase().includes("application/json")) {
    throw new MobileSyncValidationError("Expected application/json.", null);
  }
  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (contentLength > MAX_IMPORT_BYTES) {
    throw new MobileSyncValidationError("Payload is too large.", null);
  }
  const text = await request.text();
  if (Buffer.byteLength(text, "utf8") > MAX_IMPORT_BYTES) {
    throw new MobileSyncValidationError("Payload is too large.", null);
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new MobileSyncValidationError("Malformed JSON.", null);
  }
}

function errorResponse(error: string, status: number) {
  return NextResponse.json({ error }, { status, headers: noStoreHeaders() });
}

function noStoreHeaders() {
  return { "Cache-Control": "private, no-store" };
}
