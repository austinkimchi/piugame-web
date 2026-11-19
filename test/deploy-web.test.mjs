import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { once } from "node:events";
import { lstat, mkdir, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { configuration, readiness } from "../scripts/deploy-web.mjs";
import { MANUAL_PATHS, exists, inventory, treeBytes } from "../scripts/deploy-files.mjs";
import { fixture, git, testDeployment, write } from "./fixtures/deployment.mjs";

const pendingPath = (f) => path.join(f.state, "recovery/pending.json");
async function original(f, { fresh = false } = {}) {
  assert.equal(await git(f.app, "rev-parse", "HEAD"), f.prior);
  assert.equal((await readFile(path.join(f.state, "deployed-commit"), "utf8")).trim(), f.prior);
  assert.equal(await readFile(path.join(f.app, ".next/BUILD_ID"), "utf8"), "old");
  assert.equal(await readFile(path.join(f.app, ".env"), "utf8"), "PRIVATE_SENTINEL_DO_NOT_COPY=fixture-only\n");
  for (const relative of MANUAL_PATHS) assert.equal(await readFile(path.join(f.app, relative, "tracked % clip.wav"), "utf8"), fresh ? "fresh-during-health" : "curated-original");
}

test("isolated build promotes coherent artifacts and preserves exact manual media/configuration", async (t) => {
  const f = await fixture(t); const envMode = (await lstat(path.join(f.app, ".env"))).mode;
  const { deployment, calls } = await testDeployment(f, { checkpoint: async (name, driver) => {
    if (name === "stage:build") {
      assert.equal(await exists(path.join(driver.stage, ".env")), false);
      assert.equal((JSON.parse(await readFile(path.join(f.root, "service.json"), "utf8"))).active, true);
    }
  } });
  assert.equal((await deployment.deploy()).outcome, "deployed");
  assert.equal(await git(f.app, "rev-parse", "HEAD"), f.candidate);
  assert.equal(await readFile(path.join(f.app, ".next/BUILD_ID"), "utf8"), "new");
  assert.equal((await lstat(path.join(f.app, ".env"))).mode, envMode);
  for (const relative of MANUAL_PATHS) assert.equal(await readFile(path.join(f.app, relative, "tracked % clip.wav"), "utf8"), "curated-original");
  for (const relative of MANUAL_PATHS) assert.equal(await readFile(path.join(f.app, relative, "new-source-clip.wav"), "utf8"), "new-reviewed-source-clip");
  assert.equal(await exists(pendingPath(f)), false);
  assert.deepEqual((await readdir(path.join(f.state, "recovery"))).sort(), ["snapshot"]);
  assert.equal(await exists(path.join(f.state, "recovery/snapshot/.env")), false);
  assert.equal(calls.filter((args) => args[0].endsWith("/npm")).length, 2);
});

test("unchanged remote uses a periodic full sweep followed by lightweight polls", async (t) => {
  const f = await fixture(t);
  await git(f.origin, "reset", "--hard", f.prior);
  let healthCalls = 0;
  const first = await testDeployment(f, { health: async () => { healthCalls++; } });
  assert.deepEqual(await first.deployment.deploy(), { outcome: "current", commit: f.prior });
  assert.equal(healthCalls, 1);
  assert.equal(await exists(path.join(f.state, "integrity-sweep.json")), true);
  const { deployment, calls } = await testDeployment(f, { health: async () => { healthCalls++; } });
  assert.deepEqual(await deployment.deploy(), { outcome: "current", commit: f.prior });
  assert.equal(healthCalls, 1);
  assert.equal(calls.some((args) => args[0] === "/usr/bin/git" && args[1] === "ls-remote"), true);
  assert.equal(calls.some((args) => args[0] === "/usr/bin/git" && ["fetch", "ls-tree"].includes(args[1])), false);
  assert.equal(calls.some((args) => args[0] === "/usr/bin/git" && args[1] === "status" && args.includes("--untracked-files=all")), false);
});

test("periodic sweep detects runtime drift that lightweight polls intentionally defer", async (t) => {
  const f = await fixture(t);
  await git(f.origin, "reset", "--hard", f.prior);
  let uptimeMs = 1000;
  const options = { integrityClock: async () => ({ bootId: "00000000-0000-0000-0000-000000000002", uptimeMs }) };
  assert.equal((await (await testDeployment(f, options)).deployment.deploy()).outcome, "current");
  await rm(path.join(f.app, ".next/BUILD_ID"));
  uptimeMs += 1000;
  assert.equal((await (await testDeployment(f, options)).deployment.deploy()).outcome, "current");
  uptimeMs += 5 * 60_000;
  await assert.rejects((await testDeployment(f, options)).deployment.deploy(), /ENOENT|BUILD_ID/);
});

test("host reboot forces a full sweep before an unchanged result", async (t) => {
  const f = await fixture(t);
  await git(f.origin, "reset", "--hard", f.prior);
  let bootId = "00000000-0000-0000-0000-000000000002";
  const options = { integrityClock: async () => ({ bootId, uptimeMs: 1000 }) };
  assert.equal((await (await testDeployment(f, options)).deployment.deploy()).outcome, "current");
  await rm(path.join(f.app, ".next/BUILD_ID"));
  bootId = "00000000-0000-0000-0000-000000000003";
  await assert.rejects((await testDeployment(f, options)).deployment.deploy(), /ENOENT|BUILD_ID/);
});

test("corrupt integrity sweep state fails closed", async (t) => {
  const f = await fixture(t);
  await git(f.origin, "reset", "--hard", f.prior);
  assert.equal((await (await testDeployment(f)).deployment.deploy()).outcome, "current");
  await write(path.join(f.state, "integrity-sweep.json"), '{"schema":2}\n');
  await assert.rejects((await testDeployment(f)).deployment.deploy(), /Invalid integrity sweep record/);
});

test("remote lookup failure neither claims current nor advances the sweep record", async (t) => {
  const f = await fixture(t);
  await git(f.origin, "reset", "--hard", f.prior);
  assert.equal((await (await testDeployment(f)).deployment.deploy()).outcome, "current");
  const sweep = await readFile(path.join(f.state, "integrity-sweep.json"));
  await git(f.origin, "branch", "-m", "unavailable");
  await assert.rejects((await testDeployment(f)).deployment.deploy());
  assert.deepEqual(await readFile(path.join(f.state, "integrity-sweep.json")), sweep);
});

test("lightweight poll fails closed on tracked drift and never contacts the remote", async (t) => {
  const f = await fixture(t);
  await git(f.origin, "reset", "--hard", f.prior);
  await write(path.join(f.app, "app.txt"), "unexpected tracked change");
  const { deployment, calls } = await testDeployment(f);
  await assert.rejects(deployment.deploy(), /tracked source/);
  assert.equal(calls.some((args) => args[0] === "/usr/bin/git" && args[1] === "ls-remote"), false);
});

test("force bypasses the lightweight shortcut and retains the full deployment path", async (t) => {
  const f = await fixture(t);
  await git(f.origin, "reset", "--hard", f.prior);
  const { deployment, calls } = await testDeployment(f);
  assert.equal((await deployment.deploy({ force: true })).outcome, "deployed");
  assert.equal(calls.some((args) => args[0] === "/usr/bin/git" && args[1] === "ls-remote"), false);
  assert.equal(calls.some((args) => args[0] === "/usr/bin/git" && args[1] === "fetch"), true);
});

for (const failure of ["install", "build", "snapshot", "switch", "start", "health", "marker"]) {
  test(`${failure} failure restores the exact prior runtime and suppresses the failed SHA`, async (t) => {
    const f = await fixture(t); let fired = false;
    const { deployment } = await testDeployment(f, {
      beforeCommand: async (args, cwd) => {
        const matches = failure === "install" && args[1] === "ci" || failure === "build" && args[1] === "run" ||
          failure === "snapshot" && args[0] === "/bin/cp" && args.at(-1).includes("snapshot/runtime") ||
          failure === "start" && args[2] === "start" && (await readFile(path.join(cwd, "app.txt"), "utf8")) === "new";
        if (matches && !fired) { fired = true; throw new Error(`Injected ${failure}`); }
      },
      health: async (version) => { if (failure === "health" && version === "new") { fired = true; throw new Error("Injected health"); } },
      checkpoint: async (name) => {
        if ((failure === "switch" && name === "switch:.next" || failure === "marker" && name === "marker:written") && !fired) { fired = true; throw new Error(`Injected ${failure}`); }
      },
    });
    assert.equal((await deployment.deploy()).outcome, "rolled-back"); assert.equal(fired, true);
    await original(f); assert.equal(await exists(pendingPath(f)), false);
    const retry = await testDeployment(f); assert.equal((await retry.deployment.deploy()).outcome, "suppressed");
    assert.equal(retry.calls.some((args) => args[0].endsWith("/npm")), false);
    assert.equal((await (await testDeployment(f)).deployment.deploy({ force: true })).outcome, "deployed");
  });
}

test("rollback captures latest uploads and accepts a legitimate new catalog total", async (t) => {
  const f = await fixture(t); let changed = false;
  const { deployment } = await testDeployment(f, { health: async (version, service) => {
    if (version === "new" && !changed) {
      changed = true;
      for (const relative of MANUAL_PATHS) {
        await write(path.join(f.app, relative, "tracked % clip.wav"), "fresh-during-health");
        await write(path.join(f.app, relative, "new-hash-upload.wav"), "new-during-health");
      }
      service.total = 676;
      await writeFile(path.join(f.root, "service.json"), JSON.stringify(service));
    }
  } });
  assert.equal((await deployment.deploy()).outcome, "rolled-back"); await original(f, { fresh: true });
  for (const relative of MANUAL_PATHS) assert.equal(await readFile(path.join(f.app, relative, "new-hash-upload.wav"), "utf8"), "new-during-health");
  assert.equal(JSON.parse(await readFile(path.join(f.root, "service.json"), "utf8")).total, 676);
});

test("rollback failure retains evidence and next invocation recovers before fetch, including --force", async (t) => {
  const f = await fixture(t); let failRollback = true;
  const { deployment } = await testDeployment(f, {
    health: async (version) => { if (version === "new") throw new Error("Candidate unhealthy"); },
    beforeCommand: async (args) => { if (failRollback && args[1] === "reset" && args.at(-1) === f.prior) { failRollback = false; throw new Error("Injected rollback failure"); } },
  });
  await assert.rejects(deployment.deploy(), /rollback failure/);
  assert.equal(JSON.parse(await readFile(pendingPath(f), "utf8")).phase, "restoring");
  const next = await testDeployment(f, { beforeCommand: async (args) => { if (args[1] === "fetch") throw new Error("Network offline"); } });
  assert.equal((await next.deployment.deploy({ force: true })).outcome, "rolled-back");
  assert.equal(next.calls.some((args) => args[1] === "fetch"), false); await original(f);
  assert.equal(next.calls.some((args) => args[1] === "ls-remote"), false);
});

const runner = fileURLToPath(new URL("./fixtures/deployment.mjs", import.meta.url));
for (const boundary of ["phase:staging", "phase:preparing", "phase:switching", "switch:source", "switch:.next", "switch:node_modules", "phase:running", "marker:written", "phase:committed"]) {
  test(`SIGKILL at ${boundary} recovers coherent source/runtime/marker on the next invocation`, async (t) => {
    const f = await fixture(t);
    const child = spawn(process.execPath, [runner, f.root, boundary], { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = ""; child.stderr.on("data", (chunk) => { stderr += chunk; });
    const [code, signal] = await once(child, "exit"); assert.equal(code, null, stderr); assert.equal(signal, "SIGKILL", stderr);
    const next = await testDeployment(f, { beforeCommand: async (args) => { if (args[1] === "fetch") throw new Error("Recovery must precede fetch"); } });
    const result = await next.deployment.deploy({ force: true });
    if (boundary === "phase:committed") assert.equal(result.commit, f.candidate);
    else { assert.equal(result.outcome, "rolled-back"); await original(f); }
    assert.equal(await exists(pendingPath(f)), false);
  });
}

test("SIGKILL during rollback keeps the freshest durable media capture", async (t) => {
  const f = await fixture(t);
  const first = spawn(process.execPath, [runner, f.root, "marker:written"], { env: { ...process.env, TEST_LATEST_MEDIA: "1" }, stdio: "ignore" });
  assert.equal((await once(first, "exit"))[1], "SIGKILL");
  const second = spawn(process.execPath, [runner, f.root, "rollback:.next"], { stdio: "ignore" });
  assert.equal((await once(second, "exit"))[1], "SIGKILL");
  assert.equal(JSON.parse(await readFile(pendingPath(f), "utf8")).phase, "restoring");
  assert.equal((await (await testDeployment(f)).deployment.deploy()).outcome, "rolled-back");
  await original(f, { fresh: true });
  for (const relative of MANUAL_PATHS) assert.equal(await readFile(path.join(f.app, relative, "new-hash-upload.wav"), "utf8"), "new-during-health");
});

test("dirty source, escaping links, insufficient storage and malformed state fail closed", async (t) => {
  const f = await fixture(t);
  await write(path.join(f.app, "app.txt"), "unexpected user change");
  await assert.rejects((await testDeployment(f)).deployment.deploy({ force: true }), /dirty source/);
  await git(f.app, "checkout", "--", "app.txt");
  await symlink(f.origin, path.join(f.app, "node_modules/escape"));
  await assert.rejects((await testDeployment(f)).deployment.deploy(), /symlink/);
  await rm(path.join(f.app, "node_modules/escape"));
  const small = await testDeployment(f); small.deployment.config.maxManagedBytes = 1;
  const limited = await small.deployment.deploy(); assert.equal(limited.outcome, "rolled-back"); assert.equal(limited.failure.reason, "storage-limit");
  await write(pendingPath(f), "{broken");
  const malformed = await testDeployment(f); await assert.rejects(malformed.deployment.deploy({ force: true }));
  assert.equal(malformed.calls.every((args) => args[0] === "/usr/bin/systemctl" && args[2] === "show"), true); await original(f);
});

test("relative internal runtime links survive relocation; absolute and traversal links do not", async (t) => {
  const f = await fixture(t);
  await inventory(f.app, ["node_modules"], { links: true });
  await symlink("../../origin/app.txt", path.join(f.app, "node_modules/escape"));
  await assert.rejects(inventory(f.app, ["node_modules"], { links: true }), /symlink/);
});

test("readiness verifies origin static bytes and rejects fallback/shape/count mismatch", async (t) => {
  const f = await fixture(t);
  let total = 675; let staticBytes = "build-old"; let song = { slug: "song", title: "Song", artist: "Artist", chartSummary: ["S1"] };
  const server = createServer((req, res) => {
    if (req.url === "/") res.end('<script src="/_next/static/main.js"></script>');
    else if (req.url.startsWith("/_next")) res.end(staticBytes);
    else res.end(JSON.stringify({ total, songs: [song], nextCursor: "1" }));
  });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  t.after(() => { server.closeAllConnections(); return new Promise((resolve) => server.close(resolve)); });
  const config = configuration({ ...f.config, origin: `http://127.0.0.1:${server.address().port}` });
  assert.equal(await readiness(config, f.app, 675), 675);
  total = 250; await assert.rejects(readiness(config, f.app), /minimum/);
  total = 676; await assert.rejects(readiness(config, f.app, 675), /changed/);
  assert.equal(await readiness(config, f.app), 676);
  song = { slug: "bad" }; await assert.rejects(readiness(config, f.app), /shape/);
  staticBytes = "wrong build"; await assert.rejects(readiness(config, f.app), /static asset/);
});

test("stage build uses explicit public URL and no inherited production credentials", async (t) => {
  const f = await fixture(t);
  const previous = process.env.DEPLOY_TEST_SECRET;
  process.env.DEPLOY_TEST_SECRET = "fixture-secret-must-not-reach-build";
  t.after(() => { if (previous === undefined) delete process.env.DEPLOY_TEST_SECRET; else process.env.DEPLOY_TEST_SECRET = previous; });
  let checked = false;
  const { deployment } = await testDeployment(f, { beforeCommand: async (args, _cwd, env) => {
    if (args[0].endsWith("/npm") && args[1] === "run") {
      checked = true;
      assert.equal(env.NEXT_PUBLIC_SITE_URL, f.config.siteUrl);
      assert.equal(env.MONGODB_URI, "");
      assert.equal(env.DEPLOY_TEST_SECRET, undefined);
      assert.equal(env.GITHUB_PACKAGES_TOKEN, undefined);
    }
  } });
  assert.equal((await deployment.deploy()).outcome, "deployed"); assert.equal(checked, true);
});

test("TERM abort is cleaned before rollback and cannot abort the recovery commands", async (t) => {
  const f = await fixture(t); const controller = new AbortController();
  const { deployment } = await testDeployment(f, { signal: controller.signal, checkpoint: async (name) => {
    if (name === "switch:.next") controller.abort();
  } });
  const result = await deployment.deploy();
  assert.equal(result.outcome, "rolled-back"); assert.equal(result.failure.reason, "aborted"); await original(f);
});

test("orphan command evidence blocks all commands, recovery and stage cleanup even with --force", async (t) => {
  const f = await fixture(t);
  const child = spawn(process.execPath, [runner, f.root, "switch:.next"], { stdio: "ignore" });
  assert.equal((await once(child, "exit"))[1], "SIGKILL");
  const root = path.join(f.state, "recovery");
  const journal = await readFile(pendingPath(f));
  await write(path.join(root, "inflight.json"), JSON.stringify({ schema: 1, phase: "switching", operation: "git:reset", time: "test" }));
  const { deployment, calls } = await testDeployment(f);
  await assert.rejects(deployment.deploy({ force: true }), /Unfinished deployment command evidence/);
  assert.deepEqual(calls, []);
  assert.deepEqual(await readFile(pendingPath(f)), journal);
  assert.equal(await exists(path.join(root, "transaction/stage")), true);
});

test("abrupt death after publishing an in-flight command does not start its writer", async (t) => {
  const f = await fixture(t);
  const child = spawn(process.execPath, [runner, f.root, "command:published"], { stdio: "ignore" });
  assert.equal((await once(child, "exit"))[1], "SIGKILL");
  const { deployment, calls } = await testDeployment(f);
  await assert.rejects(deployment.deploy(), /Unfinished deployment command evidence/);
  assert.deepEqual(calls, []); await original(f);
});

for (const anomaly of ["git-lock", "dirty-source", "unexpected-service", "snapshot-corrupt"]) {
  test(`${anomaly} during a pending switch retains media/evidence for operator inspection`, async (t) => {
    const f = await fixture(t);
    const child = spawn(process.execPath, [runner, f.root, "phase:switching"], { stdio: "ignore" });
    assert.equal((await once(child, "exit"))[1], "SIGKILL");
    if (anomaly === "git-lock") await write(path.join(f.app, ".git/index.lock"), "ambiguous unfinished git operation");
    if (anomaly === "dirty-source") await write(path.join(f.app, "app.txt"), "partially written/unknown source");
    if (anomaly === "snapshot-corrupt") await write(path.join(f.state, "recovery/snapshot/runtime/.next/BUILD_ID"), "damaged");
    if (anomaly === "unexpected-service") {
      await write(path.join(f.root, "service.json"), JSON.stringify({ active: true, total: 675 }));
      await write(path.join(f.app, MANUAL_PATHS[1], "post-reboot-upload.wav"), "preserve unknown startup upload");
    }
    const bytes = await readFile(pendingPath(f));
    const { deployment, calls } = await testDeployment(f);
    await assert.rejects(deployment.deploy({ force: true }));
    assert.equal(calls.some((args) => args[1] === "reset" || args[2] === "stop" || args[2] === "start"), false);
    assert.deepEqual(await readFile(pendingPath(f)), bytes);
    if (anomaly === "unexpected-service") assert.equal(await readFile(path.join(f.app, MANUAL_PATHS[1], "post-reboot-upload.wav"), "utf8"), "preserve unknown startup upload");
  });
}

test("source commits cannot replace protected runtime or manual-directory roots", async (t) => {
  const f = await fixture(t);
  await rm(path.join(f.origin, MANUAL_PATHS[0]), { recursive: true });
  await write(path.join(f.origin, MANUAL_PATHS[0]), "wrong shape");
  await git(f.origin, "add", "."); await git(f.origin, "commit", "-m", "invalid layout");
  const { deployment, calls } = await testDeployment(f);
  await assert.rejects(deployment.deploy(), /protected runtime\/media/);
  assert.equal(calls.some((args) => args[2] === "stop"), false); await original(f);
});

test("journal storage failure before switching restarts untouched runtime and records a bounded receipt", async (t) => {
  const f = await fixture(t); const { deployment } = await testDeployment(f);
  const journal = deployment.journal.bind(deployment);
  deployment.journal = async (phase, extra) => {
    if (phase === "switching") throw Object.assign(new Error("No space for journal"), { code: "ENOSPC" });
    return journal(phase, extra);
  };
  const result = await deployment.deploy(); assert.equal(result.outcome, "rolled-back"); await original(f);
  const receipt = JSON.parse(await readFile(path.join(f.state, "recovery/failed.json"), "utf8"));
  assert.equal(receipt.failure.reason, "storage-limit");
  assert.equal(JSON.stringify(receipt).includes("PRIVATE_SENTINEL"), false);
  assert.equal(await exists(pendingPath(f)), false);
});

test("storage scans tolerate install directories concurrently disappearing or becoming files", async (t) => {
  const f = await fixture(t); const changing = path.join(f.root, "changing");
  await mkdir(changing);
  const mutate = async () => {
    for (let i = 0; i < 80; i++) {
      await mkdir(path.join(changing, "temporary"), { recursive: true });
      await writeFile(path.join(changing, "temporary/value"), "small");
      await rm(path.join(changing, "temporary"), { recursive: true });
      await writeFile(path.join(changing, "temporary"), "replaced");
      await rm(path.join(changing, "temporary"));
    }
  };
  await Promise.all([mutate(), (async () => { for (let i = 0; i < 160; i++) assert.ok(await treeBytes(changing) >= 0); })()]);
});

test("promotion keeps new candidate media when the old version's manual root is absent", async (t) => {
  const f = await fixture(t, { missingManualPath: MANUAL_PATHS[0] });
  assert.equal(await exists(path.join(f.app, MANUAL_PATHS[0])), false);
  const { deployment } = await testDeployment(f);
  assert.equal((await deployment.deploy()).outcome, "deployed");
  assert.equal(await readFile(path.join(f.app, MANUAL_PATHS[0], "new-source-clip.wav"), "utf8"), "new-reviewed-source-clip");
  assert.equal(await exists(path.join(f.app, MANUAL_PATHS[0], "manual")), false);
  const manifest = JSON.parse(await readFile(path.join(f.state, "recovery/snapshot/manifest.json"), "utf8"));
  assert.equal(manifest.media.find((entry) => entry.path === MANUAL_PATHS[0]).type, "missing");
});

test("failure halfway through latest-media capture retains live uploads and retries capture safely", async (t) => {
  const f = await fixture(t); let uploadDone = false; let failed = false;
  const { deployment } = await testDeployment(f, {
    health: async (version) => {
      if (version !== "new") return;
      if (!uploadDone) {
        uploadDone = true;
        for (const relative of MANUAL_PATHS) await write(path.join(f.app, relative, "tracked % clip.wav"), "fresh-during-health");
      }
      throw new Error("Fail candidate health");
    },
    beforeCommand: async (args) => {
      if (!failed && args[0] === "/bin/cp" && args.at(-1).includes("media.next/") && args.at(-1).includes("phoenix2/")) {
        failed = true; throw new Error("Injected media capture I/O failure");
      }
    },
  });
  await assert.rejects(deployment.deploy(), /media capture I\/O/);
  assert.equal(failed, true);
  assert.equal(JSON.parse(await readFile(pendingPath(f), "utf8")).phase, "running");
  assert.equal(await exists(path.join(f.state, "recovery/inflight.json")), false);
  for (const relative of MANUAL_PATHS) {
    assert.equal(await readFile(path.join(f.app, relative, "tracked % clip.wav"), "utf8"), "fresh-during-health");
    assert.equal(await readFile(path.join(f.state, "recovery/snapshot/media", relative, "tracked % clip.wav"), "utf8"), "curated-original");
  }
  assert.equal((await (await testDeployment(f)).deployment.deploy()).outcome, "rolled-back");
  await original(f, { fresh: true });
});

for (const failure of ["client-timeout", "active-state", "pending-job"]) {
  test(`unverified initial stop (${failure}) retains evidence without starting or resetting the app`, async (t) => {
    const f = await fixture(t); let attempted = false;
    const { deployment, calls } = await testDeployment(f, {
      beforeCommand: async (args) => {
        if (args[0] === "/usr/bin/systemctl" && args[2] === "stop") {
          attempted = true;
          if (failure === "client-timeout") throw new Error("Deployment command timed out");
        }
      },
      afterCommand: async (args) => {
        if (args[0] === "/usr/bin/systemctl" && args[2] === "stop") {
          await writeFile(path.join(f.root, "service.json"), JSON.stringify({ active: failure === "active-state", total: 675,
            ...(failure === "pending-job" ? { job: "123 piugame-web.service" } : {}) }));
        }
      },
    });
    await assert.rejects(deployment.deploy(), /Unfinished deployment command evidence/);
    assert.equal(attempted, true);
    assert.equal(calls.some((args) => args[2] === "start" || args[1] === "reset" || args[0] === "/bin/cp"), false);
    assert.equal(JSON.parse(await readFile(pendingPath(f), "utf8")).phase, "preparing");
    const sentinel = JSON.parse(await readFile(path.join(f.state, "recovery/inflight.json"), "utf8"));
    assert.equal(sentinel.operation, "systemctl:stop");
    await original(f);
    const retry = await testDeployment(f);
    await assert.rejects(retry.deployment.deploy({ force: true }), /Unfinished deployment command evidence/);
    assert.deepEqual(retry.calls, []);
  });
}
