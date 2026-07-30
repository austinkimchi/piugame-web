import { type NextRequest, NextResponse } from "next/server";

import { getCurrentUser, isAdmin } from "@/lib/auth";
import { updateCatalogSong } from "@/lib/catalog";
import type { CatalogEditorPayload } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  }
  if (!isAdmin(user)) {
    return NextResponse.json({ error: "Admin permission required." }, { status: 403 });
  }

  const { slug } = await params;
  const body = (await request.json().catch(() => null)) as Partial<CatalogEditorPayload> | null;
  if (!body) {
    return NextResponse.json({ error: "Missing catalog edits." }, { status: 400 });
  }

  try {
    const song = await updateCatalogSong(slug, body);
    return NextResponse.json(
      { song },
      {
        headers: {
          "Cache-Control": "private, no-store",
        },
      },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not update catalog.";
    const status = /not found/i.test(message) ? 404 : /not configured/i.test(message) ? 503 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
