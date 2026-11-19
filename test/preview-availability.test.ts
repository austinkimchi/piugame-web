import assert from "node:assert/strict";
import test from "node:test";

import { createPreviewAvailability } from "../src/lib/preview-availability.ts";

const origin = () => "https://mypiu.example";
const preview = "/api/audio-file?path=phoenix2%2Faudio_previews%2Fmanual%2F%25X.wav";

test("does no preflight and ignores autoplay, cancellation and decoding failures", async () => {
  let requests = 0;
  const availability = createPreviewAvailability(origin, async () => {
    requests += 1;
    return new Response(null, { status: 404 });
  });
  const unsubscribe = availability.subscribe(() => {});
  assert.equal(availability.isUnavailable(preview), false);
  for (const error of [null, { code: 1 }, { code: 3 }]) {
    assert.equal(await availability.confirmMediaFailure(preview, error), false);
  }
  assert.equal(requests, 0);
  unsubscribe();
});

test("deduplicates failed loads, confirms a 404 with one byte, and notifies both players", async () => {
  let requests = 0;
  let finish!: (response: Response) => void;
  let cancelled = false;
  const availability = createPreviewAvailability(origin, async (url, init) => {
    requests += 1;
    assert.equal(url, origin() + preview);
    assert.equal(new Headers(init?.headers).get("Range"), "bytes=0-0");
    assert.equal(init?.cache, "no-store");
    assert.equal(init?.credentials, "same-origin");
    assert.equal(init?.redirect, "error");
    assert.ok(init?.signal);
    return new Promise<Response>((resolve) => { finish = resolve; });
  });
  const observed: boolean[] = [];
  const unsubscribeCard = availability.subscribe(() => observed.push(availability.isUnavailable(preview)));
  const unsubscribeDetail = availability.subscribe(() => observed.push(availability.isUnavailable(origin() + preview)));
  const cardFailure = availability.confirmMediaFailure(preview, { code: 4 });
  const detailFailure = availability.confirmMediaFailure(origin() + preview, { code: 2 });
  assert.equal(cardFailure, detailFailure);
  await Promise.resolve();
  finish(new Response(new ReadableStream({ cancel() { cancelled = true; } }), { status: 404 }));
  assert.equal(await cardFailure, true);
  assert.deepEqual(observed, [true, true]);
  assert.equal(cancelled, true);
  assert.equal(await availability.confirmMediaFailure(preview, { code: 4 }), true);
  assert.equal(requests, 1);
  unsubscribeCard();
  unsubscribeDetail();
});

test("does not mistake successful, forbidden, transient or other HTTP responses for a missing clip", async () => {
  for (const status of [200, 206, 400, 401, 403, 416, 429, 500, 502, 503]) {
    let cancelled = false;
    const availability = createPreviewAvailability(origin, async () => new Response(
      new ReadableStream({ cancel() { cancelled = true; } }), { status },
    ));
    assert.equal(await availability.confirmMediaFailure(preview, { code: 4 }), false, String(status));
    assert.equal(availability.isUnavailable(preview), false, String(status));
    assert.equal(cancelled, true, "even a server ignoring Range must not download the full clip");
  }
});

test("a network failure remains retryable and does not notify players that a clip is missing", async () => {
  let requests = 0;
  let notifications = 0;
  const availability = createPreviewAvailability(origin, async () => {
    if (++requests === 1) throw new TypeError("Failed to fetch");
    return new Response(null, { status: 404 });
  });
  availability.subscribe(() => { notifications += 1; });
  assert.equal(await availability.confirmMediaFailure(preview, { code: 2 }), false);
  assert.equal(availability.isUnavailable(preview), false);
  assert.equal(notifications, 0);
  assert.equal(await availability.confirmMediaFailure(preview, { code: 2 }), true);
  assert.equal(requests, 2);
  assert.equal(notifications, 1);
});

test("only confirms same-origin HTTP media URLs in a browser session", async () => {
  let requests = 0;
  const fetcher: typeof fetch = async () => { requests += 1; return new Response(null, { status: 404 }); };
  const availability = createPreviewAvailability(origin, fetcher);
  for (const url of [null, "", "https://other.example/preview.wav", "//other.example/preview.wav", "data:audio/wav;base64,AAAA", "https://user:password@mypiu.example/preview.wav"]) {
    assert.equal(await availability.confirmMediaFailure(url, { code: 4 }), false);
  }
  const server = createPreviewAvailability(() => null, fetcher);
  assert.equal(await server.confirmMediaFailure(preview, { code: 4 }), false);
  assert.equal(requests, 0);
});

test("a changed upload URL or a fresh page session is not blocked by an earlier 404", async () => {
  const availability = createPreviewAvailability(origin, async () => new Response(null, { status: 404 }));
  await availability.confirmMediaFailure(preview, { code: 4 });
  assert.equal(availability.isUnavailable(preview), true);
  assert.equal(availability.isUnavailable("/api/audio-file?path=manual%2Fx-pory-newhash.wav"), false);
  assert.equal(createPreviewAvailability(origin).isUnavailable(preview), false);
});
