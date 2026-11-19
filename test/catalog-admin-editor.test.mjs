import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { setImmediate as nextTurn } from "node:timers/promises";
import test from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { load } from "cheerio";
import ts from "typescript";
import * as upscoreSummary from "../src/lib/performance-upscore-summary.ts";

const require = createRequire(import.meta.url);
function componentSource(name) {
  return ts.transpileModule(readFileSync(new URL(`../src/components/${name}.tsx`, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText;
}
const outputText = componentSource("catalog-admin-editor");
const song = {
  slug: "fixture % song", title: "Original", artist: "Fixture", folder: "ORIGINAL", folderPosition: 1,
  series: "PHOENIX2", tags: ["test"], chartSummary: ["S16"], history: [], chartHistory: [], chartLinks: [],
  audioPath: null, previewUrl: null,
};

// Execute the unchanged component and its actual event handlers with isolated state cells.
// Network is injected lexically: these tests cannot contact a catalog or upload media.
function fixture(overrides = {}) {
  const fixtureSong = { ...song, ...overrides };
  const state = [];
  let cursor = 0;
  const requests = [];
  const saved = [];
  const hooks = {
    ...React,
    useMemo: (fn) => fn(),
    useRef: (initial) => hooks.useState(() => ({ current: initial }))[0],
    useState(initial) {
      const index = cursor++;
      if (!(index in state)) state[index] = typeof initial === "function" ? initial() : initial;
      return [state[index], (value) => { state[index] = typeof value === "function" ? value(state[index]) : value; }];
    },
  };
  const loaded = { exports: {} };
  new Function("require", "module", "exports", "fetch", outputText)((name) => {
    if (name === "react") return hooks;
    if (name === "@/lib/admin-view-mode") return { useAdminViewMode: () => ({ viewingAsRegular: false }) };
    return require(name);
  }, loaded, loaded.exports, (url, options) => new Promise((resolve, reject) => requests.push({ url, options, resolve, reject })));
  function render() {
    cursor = 0;
    return loaded.exports.CatalogAdminEditor({ song: fixtureSong, userIsAdmin: true, label: "fixture", catalogVersion: "phoenix2", onSaved: (value) => saved.push(value) });
  }
  function elements(node = render()) {
    if (Array.isArray(node)) return node.flatMap((child) => elements(child));
    if (!React.isValidElement(node)) return [];
    return [node, ...elements(node.props.children ?? null)];
  }
  const text = (node) => Array.isArray(node) ? node.map(text).join("") : React.isValidElement(node) ? text(node.props.children) : typeof node === "string" ? node : "";
  const button = (label) => elements().find((el) => el.type === "button" && (text(el) === label || el.props["aria-label"] === label));
  const input = () => elements().find((el) => el.type === "input" && el.props.value === "Original");
  button("Edit fixture").props.onClick();
  return { requests, saved, elements, text, button, input };
}

function startSave(f) {
  f.button("Save catalog").props.onClick();
  assert.equal(f.button("Saving").props.disabled, true);
}

function assertRetry(f) {
  assert.equal(f.button("Save catalog").props.disabled, false);
  assert.equal(f.saved.length, 0);
  assert.ok(f.elements().some((el) => el.props.role === "alert" && /Could not confirm/.test(f.text(el))));
}

test("rejected JSON save keeps edits, restores retry, and later success closes the editor once", async () => {
  const f = fixture();
  f.input().props.onChange({ target: { value: "Edited title" } });
  startSave(f);
  f.requests[0].reject(new TypeError("Network unavailable"));
  await nextTurn();
  assertRetry(f);
  assert.ok(f.elements().some((el) => el.type === "input" && el.props.value === "Edited title"));
  startSave(f);
  assert.equal(f.requests.length, 2);
  assert.equal(f.requests[1].url, "/api/songs/fixture%20%25%20song/catalog?version=phoenix2");
  assert.equal(f.requests[1].options.method, "PATCH");
  assert.equal(JSON.parse(f.requests[1].options.body).title, "Edited title");
  f.requests[1].resolve(Response.json({ song: { ...song, title: "Edited title" } }));
  await nextTurn();
  assert.equal(f.saved.length, 1);
  assert.equal(f.saved[0].title, "Edited title");
  assert.equal(f.button("Save catalog"), undefined);
});

test("rejected audio save retains the selected file and sends identical bytes on explicit retry", async () => {
  const f = fixture();
  const file = new File([new Uint8Array([1, 2, 3, 4])], "fixture.wav", { type: "audio/wav" });
  f.elements().find((el) => el.type === "input" && el.props.type === "file").props.onChange({ target: { files: [file] } });
  startSave(f);
  f.requests[0].reject(new TypeError("Connection lost"));
  await nextTurn();
  assertRetry(f);
  assert.ok(f.elements().some((el) => el.type === "span" && f.text(el) === "fixture.wav"));
  startSave(f);
  for (const request of f.requests) {
    assert.ok(request.options.body instanceof FormData);
    assert.equal(request.options.body.get("audio").name, file.name);
    assert.deepEqual(new Uint8Array(await request.options.body.get("audio").arrayBuffer()), new Uint8Array([1, 2, 3, 4]));
    assert.equal(request.options.body.get("title"), "Original");
  }
  f.requests[1].resolve(Response.json({ song }));
  await nextTurn();
  assert.equal(f.saved.length, 1);
  assert.equal(f.button("Save catalog"), undefined);
});

test("HTTP and malformed-response failures remain retryable without success callbacks", async () => {
  for (const response of [Response.json({ error: "Permission denied" }, { status: 403 }), new Response("not JSON", { status: 502 }), Response.json({})]) {
    const f = fixture();
    startSave(f);
    f.requests[0].resolve(response);
    await nextTurn();
    assert.equal(f.button("Save catalog").props.disabled, false);
    assert.equal(f.saved.length, 0);
    assert.ok(f.elements().some((el) => el.props.role === "alert"));
  }
});

test("chart fields have distinct labels and retain row identity through typing, removal, and addition", async () => {
  const f = fixture({ chartSummary: ["S7", "S11", "S16"] });
  const inputs = () => f.elements().filter((el) => el.type === "input" && /^Chart \d+ difficulty$/.test(el.props["aria-label"] ?? ""));
  const rowKey = (value) => f.elements().find((el) => el.type === "div" && Array.isArray(el.props.children) && el.props.children.some((child) => child?.type === "input" && child.props.value === value)).key;
  assert.deepEqual(inputs().map((el) => el.props["aria-label"]), ["Chart 1 difficulty", "Chart 2 difficulty", "Chart 3 difficulty"]);
  const firstKey = rowKey("S7");
  const lastKey = rowKey("S16");
  for (const value of ["S", "S1", "S19"]) {
    inputs()[0].props.onChange({ target: { value } });
    assert.equal(inputs()[0].props.value, value);
    assert.equal(inputs()[0].props["aria-label"], "Chart 1 difficulty");
    assert.equal(rowKey(value), firstKey, "editing must not replace the focused row");
  }
  f.button("Remove S11").props.onClick();
  assert.deepEqual(inputs().map((el) => el.props.value), ["S19", "S16"]);
  assert.equal(rowKey("S16"), lastKey, "removing an earlier row must not replace surviving inputs");
  f.button("Add chart").props.onClick();
  const addedKey = rowKey("");
  assert.ok(![firstKey, lastKey].includes(addedKey));
  inputs()[2].props.onChange({ target: { value: "S22" } });
  assert.equal(rowKey("S22"), addedKey);
  startSave(f);
  assert.deepEqual(JSON.parse(f.requests[0].options.body).chartTokens, ["S19", "S16", "S22"]);
  f.requests[0].resolve(Response.json({ song: { ...song, chartSummary: ["S16", "S19", "S22"] } }));
  await nextTurn();
  f.button("Edit fixture").props.onClick();
  assert.deepEqual(inputs().map((el) => el.props.value), ["S16", "S19", "S22"]);
  assert.equal(new Set(inputs().map((el) => rowKey(el.props.value))).size, 3);
});

test("home summary describes latest-session plays and the full-history destination", () => {
  const loaded = { exports: {} };
  new Function("require", "module", "exports", componentSource("home-performance-summary"))((name) => name === "@/lib/performance-upscore-summary" ? upscoreSummary : require(name), loaded, loaded.exports);
  for (const count of [0, 1, 6]) {
    const html = renderToStaticMarkup(React.createElement(loaded.exports.HomePerformanceSummary, {
      synced: true, canSync: true, recentlyPlayed: count, pumbility: null, pumbilityChange24Hours: null,
      averageBestScore: null, averageBestScoreChange24Hours: null, passedMaps: null,
      upscoresThisMonth: 0, upscoresThisWeek: 0, upscoresToday: 0,
    }));
    const $ = load(html);
    const recent = $("button").filter((_, element) => $(element).text().includes("Latest session"));
    assert.equal(recent.length, 1);
    assert.deepEqual(recent.find("p").map((_, element) => $(element).text()).get(), ["Latest session", `${count} ${count === 1 ? "play" : "plays"}`, "View all play history"]);
  }
});
