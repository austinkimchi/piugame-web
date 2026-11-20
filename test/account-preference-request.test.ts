import assert from "node:assert/strict";
import test from "node:test";
import { requestAccountPreferences } from "../src/lib/account-preference-request.ts";

test("a rejected preference request returns a recoverable error and the next request can succeed", async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const fetcher: typeof fetch = async (url, init) => {
    requests.push({ url: String(url), init });
    if (requests.length === 1) throw new TypeError("Private transport detail must not be displayed");
    return new Response(null, { status: 204 });
  };
  const failed = await requestAccountPreferences({ piuGameVersion: "phoenix" }, fetcher);
  assert.deepEqual(failed, { ok: false, error: "Could not save preference. Check your connection and try again." });
  assert.deepEqual(await requestAccountPreferences({ piuGameVersion: "phoenix" }, fetcher), { ok: true });
  assert.equal(requests.length, 2);
  for (const request of requests) {
    assert.equal(request.url, "/api/account/preferences");
    assert.equal(request.init?.method, "POST");
    assert.deepEqual(request.init?.headers, { "Content-Type": "application/json" });
    assert.deepEqual(JSON.parse(String(request.init?.body)), { piuGameVersion: "phoenix" });
  }
});

test("auto-refresh changes remain boolean and HTTP rejections preserve the server's message", async () => {
  const fetcher: typeof fetch = async (_url, init) => {
    assert.deepEqual(JSON.parse(String(init?.body)), { performanceAutoRefresh: false });
    return Response.json({ error: "Sign in again." }, { status: 401 });
  };
  assert.deepEqual(await requestAccountPreferences({ performanceAutoRefresh: false }, fetcher), { ok: false, error: "Sign in again." });
});

test("empty, malformed, or non-string HTTP errors remain safe and retryable", async () => {
  for (const body of ["", "<html>Gateway failure</html>", "null", '{"error":{}}', '{"error":"  "}']) {
    const fetcher: typeof fetch = async () => new Response(body, { status: 503 });
    assert.deepEqual(await requestAccountPreferences({ piuGameVersion: "phoenix2" }, fetcher), { ok: false, error: "Could not save preference. Please try again." });
  }
});

test("an HTTP error body read failure cannot strand preference controls", async () => {
  const response = new Response(null, { status: 500 });
  response.json = async () => { throw new Error("Response disconnected"); };
  const fetcher: typeof fetch = async () => response;
  assert.deepEqual(await requestAccountPreferences({ performanceAutoRefresh: true }, fetcher), { ok: false, error: "Could not save preference. Please try again." });
});
