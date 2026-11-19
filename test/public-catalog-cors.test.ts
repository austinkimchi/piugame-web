import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import * as http from "../src/lib/public-catalog-http.ts";
import { createPublicCatalogStore } from "../src/lib/public-catalog-cache.ts";

function assertCors(response: Response) {
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), "*");
  assert.equal(response.headers.get("Access-Control-Allow-Methods"), "GET, HEAD, OPTIONS");
  assert.equal(response.headers.get("Access-Control-Allow-Headers"), "If-None-Match");
  assert.equal(response.headers.get("Access-Control-Expose-Headers"), "ETag, Cache-Control");
  assert.equal(response.headers.get("Access-Control-Allow-Credentials"), null);
  assert.equal(response.headers.get("Set-Cookie"), null);
}

const store = createPublicCatalogStore(async () => ({ find() { return { toArray: async () => [] }; } }));

test("public GET and HEAD expose validators to any origin without credentials", async () => {
  for (const origin of ["https://other.example", "null"]) {
    for (const method of ["GET", "HEAD"]) {
      const response = await http.publicCatalogHttpResponse(new Request("https://catalog.example/api/catalog/v1/phoenix2", { method, headers: { Origin: origin } }), "phoenix2", store.getResponse);
      assert.equal(response.status, 200);
      assertCors(response);
      assert.equal(response.headers.get("Cache-Control"), http.PUBLIC_CATALOG_CACHE_CONTROL);
      assert.ok(response.headers.get("ETag"));
      if (method === "HEAD") assert.equal(await response.text(), "");
      else assert.equal((await response.json()).total, 0);
    }
  }
});

test("conditional GET and HEAD retain identical CORS policy on 304", async () => {
  const { etag } = await store.getResponse("phoenix2");
  for (const method of ["GET", "HEAD"]) {
    const response = await http.publicCatalogHttpResponse(new Request("https://catalog.example/api/catalog/v1/phoenix2", {
      method, headers: { Origin: "https://other.example", "If-None-Match": etag },
    }), "phoenix2", store.getResponse);
    assert.equal(response.status, 304);
    assertCors(response);
    assert.equal(response.headers.get("ETag"), etag);
    assert.equal(response.headers.get("Cache-Control"), http.PUBLIC_CATALOG_CACHE_CONTROL);
    assert.equal(await response.text(), "");
  }
});

test("validation and database errors remain cross-origin readable and no-store", async () => {
  for (const method of ["GET", "HEAD"]) {
    for (const version of ["invalid", "phoenix2"]) {
      const response = await http.publicCatalogHttpResponse(new Request("https://catalog.example/api/catalog/v1/" + version, {
        method, headers: { Origin: "https://other.example" },
      }), version, async () => { throw new Error("private database error"); });
      assert.equal(response.status, version === "invalid" ? 400 : 503);
      assertCors(response);
      assert.equal(response.headers.get("Cache-Control"), "no-store");
      assert.equal(response.headers.get("ETag"), null);
      const body = await response.text();
      assert.equal(body.includes("private database error"), false);
      if (method === "HEAD") assert.equal(body, "");
    }
  }
});

test("real route OPTIONS answers without database or account dependencies", async () => {
  const source = readFileSync(new URL("../src/app/api/catalog/v1/[version]/route.ts", import.meta.url), "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  let reads = 0;
  const dependencies: Record<string, unknown> = {
    "@/lib/public-catalog-http": http,
    "@/lib/public-catalog": { async getPublicCatalogResponse() { reads += 1; throw new Error("Database must not be read"); } },
  };
  const loadedModule = { exports: {} };
  new Function("require", "module", "exports", outputText)((name: string) => {
    assert.ok(Object.hasOwn(dependencies, name), `Unexpected dependency ${name}`);
    return dependencies[name];
  }, loadedModule, loadedModule.exports);
  const route = loadedModule.exports as typeof import("../src/app/api/catalog/v1/[version]/route.ts");
  const response = route.OPTIONS();
  assert.equal(response.status, 204);
  assertCors(response);
  assert.equal(response.headers.get("Allow"), "GET, HEAD, OPTIONS");
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.equal(await response.text(), "");
  assert.equal(reads, 0);
});
