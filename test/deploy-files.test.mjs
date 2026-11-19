import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstat, mkdir, mkdtemp, open, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { ARTIFACT_PATHS, forEachLimited, inventory, verifyInventory } from "../scripts/deploy-files.mjs";

const tick = () => new Promise((resolve) => setImmediate(resolve));
function deferred() {
  let resolve; let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
async function fixture(t) {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), "piu-inventory-test-")));
  t.after(() => rm(root, { recursive: true, force: true }));
  const contents = new Map([
    [".next/BUILD_ID", "test-build"],
    [".next/static/deep/asset.js", "const asset = 'verified';"],
    ["node_modules/package/index.js", "module.exports = 42;"],
    ["node_modules/package/nested/Unicode % title.txt", "음악 % fixture"],
    ["node_modules/other/empty", ""],
  ]);
  for (const [relative, value] of contents) {
    await mkdir(path.dirname(path.join(root, relative)), { recursive: true });
    await writeFile(path.join(root, relative), value);
  }
  await mkdir(path.join(root, "node_modules/.bin"));
  await symlink("../package/index.js", path.join(root, "node_modules/.bin/package"));
  return { root, contents };
}

test("bounded file work never exceeds its configured concurrency", async () => {
  let active = 0; let peak = 0; const done = [];
  await forEachLimited(Array.from({ length: 19 }, (_, i) => i), 4, async (item) => {
    active++; peak = Math.max(peak, active);
    await tick(); done.push(item); active--;
  });
  assert.equal(peak, 4); assert.equal(active, 0); assert.equal(done.length, 19);
  await assert.rejects(forEachLimited([], 0, async () => {}), /between 1 and 8/);
  await assert.rejects(forEachLimited([], 9, async () => {}), /between 1 and 8/);
});

test("a failed operation waits for all started I/O and dispatches no later files", async () => {
  const gates = Array.from({ length: 4 }, deferred);
  const started = []; let active = 0; let settled = false;
  const operation = forEachLimited(Array.from({ length: 20 }, (_, i) => i), 4, async (item) => {
    started.push(item); active++;
    try { await gates[item].promise; } finally { active--; }
  });
  const observed = operation.then(() => { settled = true; }, (error) => { settled = true; return error; });
  assert.deepEqual(started, [0, 1, 2, 3]);
  gates[1].reject(new Error("injected fsync failure"));
  await tick(); assert.equal(settled, false); assert.equal(active, 3);
  gates[0].resolve(); gates[2].resolve(); await tick();
  assert.equal(settled, false); assert.equal(active, 1);
  gates[3].resolve();
  assert.match((await observed).message, /injected fsync/);
  assert.equal(active, 0); assert.deepEqual(started, [0, 1, 2, 3]);
});

test("parallel inventories preserve deterministic checksums, modes, links and missing roots", async (t) => {
  const { root, contents } = await fixture(t);
  const names = [...ARTIFACT_PATHS, "public/assets/piu/phoenix/audio_previews/manual"];
  const sequential = await inventory(root, names, { links: true, sync: true, concurrency: 1 });
  for (const concurrency of [4, 8]) {
    assert.deepEqual(await inventory(root, names, { links: true, sync: true, concurrency }), sequential);
  }
  for (const [relative, value] of contents) {
    const entry = sequential.find((item) => item.path === relative);
    assert.equal(entry.sha256, createHash("sha256").update(value).digest("hex"));
    assert.equal(entry.size, Buffer.byteLength(value));
    assert.equal(entry.mode, (await lstat(path.join(root, relative))).mode & 0o777);
  }
  assert.equal(sequential.find((entry) => entry.path === names.at(-1)).type, "missing");
  await verifyInventory(root, names, sequential, { links: true });
  const metadata = await inventory(root, names, { links: true, hash: false });
  assert.deepEqual(metadata, sequential.map((entry) => Object.fromEntries(Object.entries(entry).filter(([key]) => key !== "sha256"))));
  await assert.rejects(inventory(root, names, { links: true, sync: true, deadline: 0 }), /timed out/);
  await symlink("../../outside", path.join(root, "node_modules/escape"));
  await assert.rejects(inventory(root, names, { links: true, sync: true }), /symlink/);
});

test("all files sync before directory barriers, and children finish before parent directories", async (t) => {
  const { root } = await fixture(t);
  const metadata = await inventory(root, ARTIFACT_PATHS, { links: true, hash: false });
  const paths = new Map();
  for (const entry of metadata) if (entry.type !== "link") {
    const stat = await lstat(path.join(root, entry.path));
    paths.set(`${stat.dev}:${stat.ino}`, entry);
  }
  const probe = await open(path.join(root, ".next/BUILD_ID"), "r");
  const prototype = Object.getPrototypeOf(probe); const original = prototype.sync;
  await probe.close();
  const events = [];
  prototype.sync = async function () {
    const stat = await this.stat(); const entry = paths.get(`${stat.dev}:${stat.ino}`);
    assert.ok(entry, "every synced handle belongs to the disposable fixture");
    events.push({ event: "start", entry });
    await tick(); await original.call(this);
    events.push({ event: "done", entry });
  };
  try { await inventory(root, ARTIFACT_PATHS, { links: true, sync: true }); }
  finally { prototype.sync = original; }
  for (const entry of paths.values()) assert.equal(events.filter((event) => event.event === "done" && event.entry.path === entry.path).length, 1);
  const lastFileDone = Math.max(...events.flatMap((event, i) => event.event === "done" && event.entry.type === "file" ? [i] : []));
  for (const [i, event] of events.entries()) if (event.event === "start" && event.entry.type === "directory") {
    assert.ok(i > lastFileDone, "directory barriers follow all file syncs");
    for (const [j, earlier] of events.entries()) if (earlier.event === "done" && earlier.entry.path.startsWith(`${event.entry.path}/`)) {
      assert.ok(j < i, "child durability completes before its parent's barrier");
    }
  }
});
