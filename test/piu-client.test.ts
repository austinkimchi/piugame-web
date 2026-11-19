import assert from "node:assert/strict";
import { createHash, X509Certificate } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import * as tls from "node:tls";
import test from "node:test";
import ts from "typescript";

const require = createRequire(import.meta.url);
function compile(relative: string, dependencies: Record<string, unknown>) {
  const source = readFileSync(new URL(relative, import.meta.url), "utf8");
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
  const loaded = { exports: {} };
  new Function("require", "module", "exports", outputText)((name: string) => {
    if (name === "server-only") return {};
    if (Object.hasOwn(dependencies, name)) return dependencies[name];
    return require(name);
  }, loaded, loaded.exports);
  return loaded.exports;
}
const { PIU_INTERMEDIATE_CA } = compile("../src/lib/piu-tls-ca.ts", {}) as { PIU_INTERMEDIATE_CA: string };

test("the reviewed intermediate matches official provenance and chains to an existing Node root", () => {
  assert.equal(createHash("sha256").update(PIU_INTERMEDIATE_CA).digest("hex"), "b40358316fd9e1caaaab92c382927d2c13ef51b481eec9371a82e16c86f2a687");
  const certificate = new X509Certificate(PIU_INTERMEDIATE_CA);
  assert.equal(certificate.fingerprint256.replaceAll(":", "").toLowerCase(), "8c54c334b66ba4e426772af4a3f9136c19a1aec729fdb28c535c07a5a4ef22e0");
  assert.equal(certificate.ca, true);
  assert.equal(new Date(certificate.validTo).toISOString(), "2036-03-21T23:59:59.000Z");
  assert.ok(Date.parse(certificate.validTo) > Date.now(), "Issuer material must be reviewed before expiry");
  const root = tls.rootCertificates.map((pem) => new X509Certificate(pem)).find((cert) => cert.subject === certificate.issuer);
  assert.ok(root, "Do not add a new trust anchor to make this chain work");
  assert.equal(certificate.verify(root.publicKey), true);
});

test("both editions receive explicit strict TLS and retain all existing runtime trust", () => {
  const captured: Array<Record<string, unknown>> = [];
  class Client { constructor(options: Record<string, unknown>) { captured.push(options); } }
  const { createPiuClient } = compile("../src/lib/piu-client.ts", {
    "@austinkimchi/piugame-sdk": { PiuClient: Client },
    "@/lib/piu-tls-ca": { PIU_INTERMEDIATE_CA },
  }) as { createPiuClient(version: string): unknown };
  const runtimeTls = tls as typeof tls & { getCACertificates?: (type: "default") => string[] };
  assert.equal(typeof runtimeTls.getCACertificates, "function");
  const defaults = runtimeTls.getCACertificates!("default");
  for (const version of ["phoenix", "phoenix2"]) {
    assert.ok(createPiuClient(version) instanceof Client);
    assert.deepEqual(captured.at(-1), { version, ca: [...defaults, PIU_INTERMEDIATE_CA], rejectUnauthorized: true, allowInsecureTlsFallback: false });
  }
  assert.deepEqual(runtimeTls.getCACertificates!("default"), defaults, "Factory must not change process trust");
});

test("all application SDK construction goes through the strict factory", () => {
  const root = new URL("../src/", import.meta.url);
  const constructors: string[] = [];
  function walk(directory: URL) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const url = new URL(entry.name + (entry.isDirectory() ? "/" : ""), directory);
      if (entry.isDirectory()) { walk(url); continue; }
      if (!/\.tsx?$/.test(entry.name)) continue;
      const source = ts.createSourceFile(entry.name, readFileSync(url, "utf8"), ts.ScriptTarget.Latest, true);
      function visit(node: ts.Node) {
        if (ts.isNewExpression(node) && node.expression.getText(source) === "PiuClient") constructors.push(url.pathname.replace(root.pathname, ""));
        ts.forEachChild(node, visit);
      }
      visit(source);
    }
  }
  walk(root);
  assert.deepEqual(constructors, ["lib/piu-client.ts"]);
  for (const [file, count] of [["piu-account.ts", 1], ["performance.ts", 4]] as const) {
    const source = readFileSync(new URL(`../src/lib/${file}`, import.meta.url), "utf8");
    assert.equal([...source.matchAll(/createPiuClient\(/g)].length, count, file);
  }
});

test("unsupported runtimes fail closed instead of replacing configured trust with bundled roots", () => {
  let constructed = false;
  const { createPiuClient } = compile("../src/lib/piu-client.ts", {
    "node:tls": {},
    "@austinkimchi/piugame-sdk": { PiuClient: class { constructor() { constructed = true; } } },
    "@/lib/piu-tls-ca": { PIU_INTERMEDIATE_CA },
  }) as { createPiuClient(version: string): unknown };
  assert.throws(() => createPiuClient("phoenix2"), /requires a Node runtime/);
  assert.equal(constructed, false);
});
