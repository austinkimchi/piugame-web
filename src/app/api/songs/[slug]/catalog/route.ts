import { type NextRequest, NextResponse } from "next/server";

import { getCurrentUser, isAdmin } from "@/lib/auth";
import { updateCatalogSong } from "@/lib/catalog";
import type { CatalogEditorPayload } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function formValue(formData: FormData, key: keyof CatalogEditorPayload): FormDataEntryValue | null {
  return formData.get(key);
}

function parseFormList(formData: FormData, key: keyof CatalogEditorPayload): string[] {
  const value = formValue(formData, key);
  if (typeof value !== "string") {
    return [];
  }

  const parsed = JSON.parse(value) as unknown;
  return Array.isArray(parsed) ? parsed.map(String) : [];
}

function parseFormJson(formData: FormData, key: keyof CatalogEditorPayload): unknown {
  const value = formValue(formData, key);
  if (typeof value !== "string") return [];
  return JSON.parse(value) as unknown;
}

function parseFormPayload(formData: FormData): Partial<CatalogEditorPayload> {
  const folderPosition = formValue(formData, "folderPosition");

  return {
    title: String(formValue(formData, "title") ?? ""),
    artist: String(formValue(formData, "artist") ?? ""),
    folder: String(formValue(formData, "folder") ?? ""),
    folderPosition: typeof folderPosition === "string" && folderPosition !== "" ? Number(folderPosition) : null,
    series: String(formValue(formData, "series") ?? ""),
    tags: parseFormList(formData, "tags"),
    chartTokens: parseFormList(formData, "chartTokens"),
    history: parseFormJson(formData, "history") as CatalogEditorPayload["history"],
    chartHistory: parseFormJson(formData, "chartHistory") as CatalogEditorPayload["chartHistory"],
    chartLinks: parseFormJson(formData, "chartLinks") as CatalogEditorPayload["chartLinks"],
  };
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  }
  if (!isAdmin(user)) {
    return NextResponse.json({ error: "Admin permission required." }, { status: 403 });
  }

  const { slug } = await params;
  const contentType = request.headers.get("content-type") ?? "";
  let body: Partial<CatalogEditorPayload> | null = null;
  let audioFile: File | null = null;

  try {
    if (contentType.includes("multipart/form-data")) {
      const formData = await request.formData().catch(() => null);
      if (formData) {
        body = parseFormPayload(formData);
        const audio = formData.get("audio");
        audioFile = audio instanceof File && audio.size > 0 ? audio : null;
      }
    } else {
      body = (await request.json().catch(() => null)) as Partial<CatalogEditorPayload> | null;
    }

    if (!body) {
      return NextResponse.json({ error: "Missing catalog edits." }, { status: 400 });
    }

    const song = await updateCatalogSong(slug, body, audioFile);
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
