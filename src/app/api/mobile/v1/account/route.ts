import { NextResponse } from "next/server";

import {
  AccountDeletionNotFoundError,
  deleteUserAccount,
} from "@/lib/account-deletion";
import { bearerTokenFromAuthorization } from "@/lib/mobile-auth-core";
import { authenticateMobileAccessToken } from "@/lib/mobile-auth";
import { PerformanceUserBusyError } from "@/lib/performance-user-lock";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(request: Request) {
  const accessToken = bearerTokenFromAuthorization(request.headers.get("authorization"));
  const identity = await authenticateMobileAccessToken(accessToken);
  if (!identity) {
    return errorResponse("invalid_token", 401);
  }

  try {
    await deleteUserAccount(identity.userId);
    return new NextResponse(null, { status: 204, headers: noStoreHeaders() });
  } catch (error) {
    if (error instanceof AccountDeletionNotFoundError) {
      return errorResponse("account_not_found", 404);
    }
    if (error instanceof PerformanceUserBusyError) {
      return NextResponse.json(
        { error: "account_busy" },
        { status: 409, headers: { ...noStoreHeaders(), "Retry-After": "2" } },
      );
    }
    console.error("Mobile account deletion failed.", error);
    return errorResponse("deletion_failed", 500);
  }
}

function errorResponse(error: string, status: number) {
  return NextResponse.json({ error }, { status, headers: noStoreHeaders() });
}

function noStoreHeaders() {
  return { "Cache-Control": "private, no-store", Pragma: "no-cache" };
}
