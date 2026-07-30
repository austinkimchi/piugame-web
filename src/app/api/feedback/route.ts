import { type NextRequest, NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { createFeedback, hasFeedbackStorage, type FeedbackKind } from "@/lib/feedback";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FEEDBACK_KINDS = new Set<FeedbackKind>(["catalog-error", "catalog-contribution", "owner-message"]);
const MAX_SUBJECT_LENGTH = 120;
const MAX_MESSAGE_LENGTH = 4000;
const MAX_CONTACT_LENGTH = 160;
const MAX_URL_LENGTH = 500;

export async function POST(request: NextRequest) {
  const ipAddress = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  const userAgent = request.headers.get("user-agent") ?? "unknown";
  if (!checkRateLimit(`${ipAddress}:${userAgent}:feedback`)) {
    return NextResponse.json({ error: "Too many submissions. Try again shortly." }, { status: 429 });
  }

  if (!hasFeedbackStorage()) {
    return NextResponse.json({ error: "Feedback storage is not configured yet." }, { status: 503 });
  }

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const kind = cleanText(body?.kind) as FeedbackKind;
  const scenario = cleanText(body?.scenario).slice(0, 80);
  const subject = cleanText(body?.subject).slice(0, MAX_SUBJECT_LENGTH);
  const message = cleanText(body?.message).slice(0, MAX_MESSAGE_LENGTH);
  const pageUrl = cleanText(body?.pageUrl).slice(0, MAX_URL_LENGTH);
  const contact = cleanText(body?.contact).slice(0, MAX_CONTACT_LENGTH);

  if (!FEEDBACK_KINDS.has(kind)) {
    return NextResponse.json({ error: "Choose a feedback type." }, { status: 400 });
  }
  if (!scenario) {
    return NextResponse.json({ error: "Choose a scenario." }, { status: 400 });
  }
  if (subject.length < 3) {
    return NextResponse.json({ error: "Add a short subject." }, { status: 400 });
  }
  if (message.length < 10) {
    return NextResponse.json({ error: "Add enough detail to act on." }, { status: 400 });
  }

  const user = await getCurrentUser();
  await createFeedback(
    {
      kind,
      scenario,
      subject,
      message,
      pageUrl,
      contact,
    },
    {
      user,
      userAgent,
      ipAddress,
    },
  );

  return NextResponse.json(
    { ok: true },
    {
      headers: { "Cache-Control": "private, no-store" },
    },
  );
}

function cleanText(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}
