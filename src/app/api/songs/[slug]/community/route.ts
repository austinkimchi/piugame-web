import { type NextRequest, NextResponse } from "next/server";

import { getSongBySlug } from "@/lib/catalog";
import {
  addSongTag,
  archiveCommunityPost,
  createCommunityPost,
  deleteCommunityPost,
  getCurrentUser,
  getSongCommunityState,
  muteCommunityUser,
  removeCommunityPost,
  removeSongTag,
  saveSongNote,
  setSongSaved,
  voteSongTag,
} from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const user = await getCurrentUser();
  const song = await getSongBySlug(slug);
  if (!song) {
    return NextResponse.json({ error: "Song not found." }, { status: 404 });
  }
  const chartToken = normalizeChartToken(request.nextUrl.searchParams.get("chart") ?? undefined, song.chartSummary);
  return NextResponse.json(await getSongCommunityState(user, slug, chartToken), {
    headers: { "Cache-Control": "private, no-store" },
  });
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  }

  const { slug } = await params;
  const song = await getSongBySlug(slug);
  if (!song) {
    return NextResponse.json({ error: "Song not found." }, { status: 404 });
  }

  const body = (await request.json().catch(() => null)) as {
    action?: string;
    saved?: boolean;
    chartToken?: string;
    tag?: string;
    vote?: 1 | -1;
    note?: string;
    body?: string;
    youtubeUrl?: string;
    caption?: string;
    postId?: string;
    targetUserId?: string;
    notes?: string;
    days?: number;
  } | null;
  if (!body?.action) {
    return NextResponse.json({ error: "Missing action." }, { status: 400 });
  }

  try {
    const chartToken = normalizeChartToken(body.chartToken, song.chartSummary);
    if (body.action === "save") {
      await setSongSaved(user, song, body.saved === true);
    } else if (body.action === "add-tag") {
      if (!chartToken) {
        return NextResponse.json({ error: "Select a chart before adding a tag." }, { status: 400 });
      }
      await addSongTag(user, song, chartToken, body.tag ?? "");
    } else if (body.action === "vote-tag") {
      if (!chartToken) {
        return NextResponse.json({ error: "Select a chart before voting on a tag." }, { status: 400 });
      }
      await voteSongTag(user, song, chartToken, body.tag ?? "", body.vote === -1 ? -1 : 1);
    } else if (body.action === "remove-tag") {
      if (!chartToken) {
        return NextResponse.json({ error: "Select a chart before removing a tag." }, { status: 400 });
      }
      await removeSongTag(user, song.slug, chartToken, body.tag ?? "");
    } else if (body.action === "note") {
      if (!chartToken) {
        return NextResponse.json({ error: "Select a chart before saving a note." }, { status: 400 });
      }
      await saveSongNote(user, song, chartToken, body.note ?? "");
    } else if (body.action === "create-post") {
      if (!chartToken) {
        return NextResponse.json({ error: "Select a chart before posting." }, { status: 400 });
      }
      await createCommunityPost(user, song, chartToken, body.body ?? "", body.youtubeUrl, body.caption);
    } else if (body.action === "archive-post") {
      await archiveCommunityPost(user, body.postId ?? "");
    } else if (body.action === "delete-post") {
      await deleteCommunityPost(user, body.postId ?? "");
    } else if (body.action === "remove-post") {
      await removeCommunityPost(user, body.postId ?? "", body.notes);
    } else if (body.action === "mute-user") {
      await muteCommunityUser(user, body.targetUserId ?? "", body.notes, body.days);
    } else {
      return NextResponse.json({ error: "Unknown action." }, { status: 400 });
    }
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Community action failed." }, { status: 400 });
  }

  return NextResponse.json(
    { state: await getSongCommunityState(user, song.slug, normalizeChartToken(body.chartToken, song.chartSummary)) },
    {
      headers: { "Cache-Control": "private, no-store" },
    },
  );
}

function normalizeChartToken(value: string | undefined, availableTokens: string[]): string | null {
  const normalized = String(value ?? "").trim().toUpperCase();
  return availableTokens.find((token) => token.toUpperCase() === normalized) ?? null;
}
