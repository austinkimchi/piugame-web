import assert from "node:assert/strict";
import test from "node:test";

import { readRequestText, RequestBodyTooLargeError, type RequestBodySource } from "../src/lib/request-body.ts";

function chunkedRequest(chunks: string[], onCancel?: () => void): RequestBodySource {
  const encoder = new TextEncoder();
  let index = 0;
  return {
    headers: new Headers(),
    body: new ReadableStream<Uint8Array>({
      pull(controller) {
        if (index >= chunks.length) {
          controller.close();
          return;
        }
        controller.enqueue(encoder.encode(chunks[index++]));
      },
      cancel() {
        onCancel?.();
      },
    }),
  };
}

test("reads chunked request bodies up to the UTF-8 byte limit", async () => {
  assert.equal(await readRequestText(chunkedRequest(["{\"name\":", "\"é\"}"]), 13), '{"name":"é"}');
});

test("cancels chunked request bodies as soon as the byte limit is exceeded", async () => {
  let cancelled = false;
  await assert.rejects(
    readRequestText(chunkedRequest(["1234", "5", "unread"], () => { cancelled = true; }), 4),
    RequestBodyTooLargeError,
  );
  assert.equal(cancelled, true);
});

test("counts multibyte text by bytes rather than characters", async () => {
  assert.equal(await readRequestText(chunkedRequest(["é", "é"]), 4), "éé");
  await assert.rejects(readRequestText(chunkedRequest(["é", "é"]), 3), RequestBodyTooLargeError);
});

test("rejects an oversized declared content length before reading the stream", async () => {
  let bodyAccessed = false;
  const request: RequestBodySource = {
    headers: new Headers({ "content-length": "100" }),
    get body() {
      bodyAccessed = true;
      return null;
    },
  };

  await assert.rejects(readRequestText(request, 10), RequestBodyTooLargeError);
  assert.equal(bodyAccessed, false);
});
