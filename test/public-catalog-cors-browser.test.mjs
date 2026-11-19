import assert from "node:assert/strict";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import test from "node:test";
import { pathToFileURL } from "node:url";
import ts from "typescript";
import * as catalogHttp from "../src/lib/public-catalog-http.ts";
import { createPublicCatalogStore } from "../src/lib/public-catalog-cache.ts";
import { bearerTokenFromAuthorization } from "../src/lib/mobile-auth-core.ts";

const require = createRequire(import.meta.url);
let playwrightPath = process.env.PLAYWRIGHT_MODULE_PATH;
if (!playwrightPath) {
  try { playwrightPath = require.resolve("playwright"); } catch { /* Optional qualification tool; never download it. */ }
}

function loadRoute(file, dependencies) {
  const source = readFileSync(new URL(file, import.meta.url), "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  const loadedModule = { exports: {} };
  new Function("require", "module", "exports", outputText)((name) => {
    assert.ok(Object.hasOwn(dependencies, name), `Unexpected route dependency ${name}`);
    return dependencies[name];
  }, loadedModule, loadedModule.exports);
  return loadedModule.exports;
}

async function listen(server) {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return `http://127.0.0.1:${server.address().port}`;
}

test("real Chromium enforces the public catalog CORS boundary across two origins", {
  skip: !playwrightPath && "Optional browser check: install/provide Playwright and a local Chromium, or set PLAYWRIGHT_MODULE_PATH and CHROMIUM_EXECUTABLE_PATH.",
  timeout: 45_000,
}, async (t) => {
  const { chromium } = await import(pathToFileURL(playwrightPath).href);
  let browser;
  try {
    browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.CHROMIUM_EXECUTABLE_PATH } : {}) });
  } catch (error) {
    if (!process.env.CHROMIUM_EXECUTABLE_PATH && /Executable doesn't exist/.test(String(error))) {
      t.skip("Optional browser check: Chromium is not installed; no download was attempted.");
      return;
    }
    throw error;
  }
  const servers = [];
  t.after(async () => {
    await browser.close();
    await Promise.all(servers.map((server) => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); })));
  });
  let catalogLoads = 0;
  const store = createPublicCatalogStore(async () => ({ find() { return { toArray: async () => [
    { songName: "Public fixture", songKey: "fixture", artist: "Fixture", piuVersion: "phoenix2", supportedVersions: ["phoenix2"], chartTokens: ["S18"] },
  ] }; } }));
  const publicRoute = loadRoute("../src/app/api/catalog/v1/[version]/route.ts", {
    "@/lib/public-catalog-http": catalogHttp,
    "@/lib/public-catalog": { async getPublicCatalogResponse(version, options) {
      catalogLoads += 1;
      if (version === "phoenix") throw new Error("Fixture database unavailable");
      return store.getResponse(version, options);
    } },
  });
  // Execute the unchanged private route's real unauthenticated branch. No user,
  // credential, database or live endpoint is available to this fixture.
  const privateRoute = loadRoute("../src/app/api/mobile/v1/catalog/overlay/route.ts", {
    "next/server": { NextResponse: { json: Response.json } },
    "@/lib/mobile-auth-core": { bearerTokenFromAuthorization },
    "@/lib/mobile-auth": { async authenticateMobileAccessToken(token) { assert.equal(token, null); return null; } },
    "@/lib/auth": {}, "@/lib/catalog-private-overlay": {}, "@/lib/performance": {},
    "@/lib/piu-version": {}, "@/lib/public-catalog": {},
  });
  const requests = [];
  const apiServer = createServer(async (incoming, outgoing) => {
    try {
      const request = new Request(`http://${incoming.headers.host}${incoming.url}`, { method: incoming.method, headers: incoming.headers });
      const pathname = new URL(request.url).pathname;
      let response;
      if (pathname.startsWith("/api/catalog/v1/")) {
        const handler = publicRoute[incoming.method];
        response = handler ? await handler(request, { params: Promise.resolve({ version: pathname.split("/").at(-1) }) }) : new Response(null, { status: 405 });
      } else {
        response = await privateRoute.GET(request);
      }
      requests.push({ method: incoming.method, pathname, status: response.status, origin: incoming.headers.origin,
        requestedMethod: incoming.headers["access-control-request-method"], requestedHeaders: incoming.headers["access-control-request-headers"],
        authorization: incoming.headers.authorization, cookie: incoming.headers.cookie });
      outgoing.writeHead(response.status, Object.fromEntries(response.headers));
      outgoing.end(Buffer.from(await response.arrayBuffer()));
    } catch {
      outgoing.writeHead(500);
      outgoing.end();
    }
  });
  servers.push(apiServer);
  const apiOrigin = await listen(apiServer);
  const pageServer = createServer((_incoming, outgoing) => {
    outgoing.writeHead(200, { "Content-Type": "text/html" });
    outgoing.end("<!doctype html><title>Isolated catalog CORS fixture</title>");
  });
  servers.push(pageServer);
  const pageOrigin = await listen(pageServer);
  assert.notEqual(apiOrigin, pageOrigin);
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(pageOrigin);
  async function browserFetch(pathname, options = {}) {
    return page.evaluate(async ({ url, options }) => {
      try {
        const response = await fetch(url, { credentials: "omit", cache: "no-store", ...options });
        return { status: response.status, etag: response.headers.get("ETag"), cacheControl: response.headers.get("Cache-Control"), body: await response.text() };
      } catch (error) { return { error: error.name }; }
    }, { url: `${apiOrigin}${pathname}`, options });
  }
  const catalogPath = "/api/catalog/v1/phoenix2";
  const preflight = await browserFetch(catalogPath, { method: "OPTIONS" });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.body, "");
  assert.equal(catalogLoads, 0, "OPTIONS must not read the catalog");
  const get = await browserFetch(catalogPath);
  assert.equal(get.status, 200);
  assert.match(get.etag, /^"[a-f0-9]{64}"$/);
  assert.equal(get.cacheControl, catalogHttp.PUBLIC_CATALOG_CACHE_CONTROL);
  assert.equal(JSON.parse(get.body).total, 1);
  assert.equal(get.body, (await store.getResponse("phoenix2")).body);
  const head = await browserFetch(catalogPath, { method: "HEAD" });
  assert.equal(head.status, 200);
  assert.equal(head.etag, get.etag);
  assert.equal(head.cacheControl, get.cacheControl);
  assert.equal(head.body, "");
  for (const method of ["GET", "HEAD"]) {
    const conditional = await browserFetch(`${catalogPath}?conditional=${method}`, { method, headers: { "If-None-Match": get.etag } });
    assert.equal(conditional.status, 304);
    assert.equal(conditional.etag, get.etag);
    assert.equal(conditional.cacheControl, get.cacheControl);
    assert.equal(conditional.body, "");
    for (const [version, status] of [["invalid", 400], ["phoenix", 503]]) {
      const response = await browserFetch(`/api/catalog/v1/${version}`, { method });
      assert.equal(response.status, status);
      assert.equal(response.cacheControl, "no-store");
      assert.equal(response.etag, null);
      if (method === "GET") assert.equal(typeof JSON.parse(response.body).error, "string");
      else assert.equal(response.body, "");
    }
  }
  assert.ok(requests.some((request) => request.method === "OPTIONS" && request.requestedMethod === "GET" && request.requestedHeaders === "if-none-match" && request.origin === pageOrigin));
  const credentialed = await browserFetch(catalogPath, { credentials: "include" });
  assert.equal(credentialed.error, "TypeError", "Wildcard origin must not permit credentialed response access");
  const beforeDeniedHeader = catalogLoads;
  const deniedHeader = await browserFetch(`${catalogPath}?denied-header=1`, { headers: { Authorization: "Bearer invalid-fixture-only" } });
  assert.equal(deniedHeader.error, "TypeError");
  assert.equal(catalogLoads, beforeDeniedHeader, "Disallowed Authorization header must be blocked at preflight");
  const privatePath = "/api/mobile/v1/catalog/overlay?version=phoenix2";
  assert.equal((await browserFetch(privatePath)).error, "TypeError", "Private route must remain unreadable across origins");
  const privateResponse = await fetch(`${apiOrigin}${privatePath}`);
  assert.equal(privateResponse.status, 401);
  assert.equal(privateResponse.headers.get("Access-Control-Allow-Origin"), null);
  assert.equal(privateResponse.headers.get("Cache-Control"), "private, no-store");
  assert.ok(requests.every((request) => !request.authorization && !request.cookie));
  t.diagnostic(JSON.stringify({ browser: browser.version(), separateLoopbackOrigins: true, checks: [
    "OPTIONS without catalog read", "GET/HEAD exposed ETag and Cache-Control", "GET/HEAD conditional304 with actual If-None-Match preflight",
    "GET/HEAD readable400and503", "credentialed fetch blocked", "Authorization preflight blocked", "unchanged private overlay blocked",
  ], preflights: requests.filter((request) => request.method === "OPTIONS").length }));
});
