#!/usr/bin/env node
import { constants } from "node:fs";
import { lstat, mkdir, open, readFile, readdir, rename, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runCommand } from "./deploy-command.mjs";
import { ARTIFACT_PATHS, MANUAL_PATHS, atomicWrite, copyTrees, digest, exists, inside,
  inventory, plainPath, readJson, spaceGuard, syncDirectory, verifyInventory, writeJson } from "./deploy-files.mjs";

const GiB = 1024 ** 3;
const sha = (value) => typeof value === "string" && /^[a-f0-9]{40}$/.test(value);
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function hostIntegrityClock() {
  const bootId = (await readFile("/proc/sys/kernel/random/boot_id", "utf8")).trim();
  const uptimeSeconds = Number((await readFile("/proc/uptime", "utf8")).split(/\s+/, 1)[0]);
  if (!/^[a-f0-9-]{36}$/.test(bootId) || !Number.isFinite(uptimeSeconds) || uptimeSeconds < 0) throw new Error("Host monotonic clock is unavailable");
  return { bootId, uptimeMs: Math.floor(uptimeSeconds * 1000) };
}
const phases = new Set(["staging", "preparing", "switching", "running", "restoring", "restored", "committed", "recovered"]);
export const DEFAULTS = Object.freeze({
  appDir: "/home/pkimchi/piugame-web-prod", stateDir: "/home/pkimchi/.local/state/piugame-web",
  service: "piugame-web.service", origin: "http://127.0.0.1:4090", host: "mypiu.austin.kim",
  siteUrl: "https://mypiu.austin.kim",
  minimumTotal: 300, maxManagedBytes: 6 * GiB, reserveBytes: GiB, integritySweepMs: 5 * 60_000,
  commandTimeoutMs: 60_000, installTimeoutMs: 300_000, buildTimeoutMs: 300_000,
  copyTimeoutMs: 120_000, stopTimeoutMs: 100_000, healthTimeoutMs: 60_000, killGraceMs: 1_000,
});

export function configuration(overrides = {}) {
  if (!overrides || Array.isArray(overrides) || typeof overrides !== "object") throw new Error("Configuration must be an object");
  for (const key of Object.keys(overrides)) if (!Object.hasOwn(DEFAULTS, key)) throw new Error(`Unknown deployment option: ${key}`);
  const config = { ...DEFAULTS, ...overrides };
  for (const [key, value] of Object.entries(config)) {
    if (typeof DEFAULTS[key] === "number" && (!Number.isSafeInteger(value) || value <= 0 || value > 12 * GiB)) throw new Error(`Invalid deployment limit: ${key}`);
    if (typeof DEFAULTS[key] === "string" && (typeof value !== "string" || !value || /[\r\n\0]/.test(value))) throw new Error(`Invalid deployment value: ${key}`);
  }
  if (config.minimumTotal <= 250) throw new Error("minimumTotal must reject the capped 250-song fallback");
  if (config.maxManagedBytes > 6 * GiB) throw new Error("Managed storage cannot exceed 6 GiB");
  for (const key of ["appDir", "stateDir"]) if (!path.isAbsolute(config[key]) || path.normalize(config[key]) !== config[key]) throw new Error(`Noncanonical ${key}`);
  if (inside(config.appDir, config.stateDir) || inside(config.stateDir, config.appDir)) throw new Error("App and state directories must be separate");
  if (!/^[a-zA-Z0-9_.-]+\.service$/.test(config.service)) throw new Error("Invalid service name");
  const origin = new URL(config.origin);
  if (origin.protocol !== "http:" || origin.hostname !== "127.0.0.1" || origin.pathname !== "/" || origin.search || origin.hash || origin.username || origin.password) throw new Error("Readiness must use the loopback HTTP origin");
  if (!/^[a-zA-Z0-9.-]+$/.test(config.host)) throw new Error("Invalid readiness Host header");
  const site = new URL(config.siteUrl);
  if (site.protocol !== "https:" || site.pathname !== "/" || site.search || site.hash || site.username || site.password) throw new Error("Invalid public site URL");
  return config;
}

export async function withDeployLock(stateDir, callback) {
  await plainPath(stateDir, { directory: true });
  const file = path.join(stateDir, "deploy.lock");
  await plainPath(file, { missing: true });
  const handle = await open(file, constants.O_CREAT | constants.O_RDWR | constants.O_NOFOLLOW, 0o600);
  const info = await handle.stat();
  if (!info.isFile() || info.nlink !== 1) { await handle.close(); throw new Error("Unexpected deployment lock inode"); }
  let retain = false;
  try {
    const code = await new Promise((resolve, reject) => {
      const child = spawn("/usr/bin/flock", ["--exclusive", "--nonblock", "3"], { stdio: ["ignore", "ignore", "ignore", handle.fd] });
      child.on("error", reject); child.on("close", resolve);
    });
    if (code === 1) return { outcome: "busy" };
    if (code !== 0) throw new Error("Cannot acquire deployment flock");
    return await callback(handle.fd);
  } catch (error) {
    if (error.cleanupUncertain) {
      retain = true;
      // The caller must not release the descriptor and allow a second writer.
      // Keep this process/lock alive for operator inspection.
      process.stderr.write("Deployment command cleanup is uncertain; lock retained. Operator inspection required.\n");
      await new Promise(() => { setInterval(() => {}, 60_000); });
    }
    throw error;
  } finally { if (!retain) await handle.close(); }
}

async function responseBytes(url, config, limit) {
  const response = await fetch(url, { headers: { Host: config.host, "Cache-Control": "no-cache", "User-Agent": "piugame-deploy-readiness" }, redirect: "error", signal: AbortSignal.timeout(5_000) });
  if (response.status !== 200) { await response.body?.cancel(); throw new Error(`Readiness HTTP ${response.status}`); }
  const chunks = []; let length = 0;
  for await (const chunk of response.body) {
    length += chunk.length;
    if (length > limit) throw new Error("Readiness response exceeded its limit");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export async function readiness(config, artifactRoot, expectedTotal) {
  const html = (await responseBytes(`${config.origin}/`, config, 2 * 1024 * 1024)).toString();
  const asset = html.match(/(?:src|href)=["'](\/_next\/static\/[A-Za-z0-9_./-]+\.(?:js|css))(?:\?[^"']*)?["']/)?.[1];
  if (!asset || asset.split("/").includes("..")) throw new Error("Readiness HTML has no safe static asset");
  const relative = asset.replace("/_next/", ".next/");
  await plainPath(path.join(artifactRoot, relative));
  const bytes = await responseBytes(`${config.origin}${asset}`, config, 8 * 1024 * 1024);
  if (createHash("sha256").update(bytes).digest("hex") !== await digest(path.join(artifactRoot, relative))) throw new Error("Readiness static asset does not match installed build");
  const data = JSON.parse((await responseBytes(`${config.origin}/api/songs/search?supportedVersion=phoenix2&limit=1`, config, 1024 * 1024)).toString());
  if (!Number.isSafeInteger(data.total) || data.total < config.minimumTotal || !Array.isArray(data.songs) || data.songs.length !== 1 ||
      typeof data.songs[0]?.slug !== "string" || !data.songs[0].slug || typeof data.songs[0]?.title !== "string" ||
      typeof data.songs[0]?.artist !== "string" || !Array.isArray(data.songs[0]?.chartSummary) ||
      (data.nextCursor !== null && typeof data.nextCursor !== "string")) throw new Error("Readiness catalog shape/minimum failed");
  if (expectedTotal !== undefined && data.total !== expectedTotal) throw new Error("Catalog total changed during deployment; database is untouched");
  return data.total;
}

/** Dependencies are injectable only through this imported API for disposable
 * tests. The installed CLI accepts reviewed path/limit config, not shell hooks. */
export class Deployment {
  constructor(config, { lockFd, signal, command = runCommand, health = readiness, checkpoint = async () => {}, integrityClock = hostIntegrityClock } = {}) {
    this.config = configuration(config); this.lockFd = lockFd; this.signal = signal;
    this.executeCommand = command; this.health = health; this.checkpoint = checkpoint; this.integrityClock = integrityClock;
    this.root = path.join(this.config.stateDir, "recovery");
    this.pendingFile = path.join(this.root, "pending.json");
    this.failedFile = path.join(this.root, "failed.json");
    this.inflightFile = path.join(this.root, "inflight.json");
    this.marker = path.join(this.config.stateDir, "deployed-commit");
    this.integritySweepFile = path.join(this.config.stateDir, "integrity-sweep.json");
    this.transaction = path.join(this.root, "transaction");
    this.stage = path.join(this.transaction, "stage");
    this.snapshot = path.join(this.root, "snapshot");
  }
  async command(args, { cwd = this.config.appDir, timeoutMs = this.config.commandTimeoutMs, build = false, install = false, recovery = false, monitored = false } = {}) {
    const program = path.basename(args[0]);
    const action = program === "systemctl" ? args[2] : args[1];
    const serviceMutation = program === "systemctl" && ["start", "stop"].includes(action);
    const mutating = program === "npm" || program === "cp" || program === "git" && ["fetch", "clone", "checkout", "update-ref", "reset"].includes(action) || serviceMutation;
    this.lastOperation = program === "npm" ? (install ? "install" : "build") : `${program}:${action ?? "run"}`;
    if (mutating) {
      await this.noInflight();
      await writeJson(this.inflightFile, { schema: 1, operation: this.lastOperation, phase: this.pending?.phase ?? "preflight", time: new Date().toISOString() });
      await this.checkpoint("command:published", this);
    }
    const env = { PATH: `${path.dirname(process.execPath)}:/usr/local/bin:/usr/bin:/bin`, HOME: process.env.HOME,
      NODE_ENV: "production", NPM_CONFIG_INCLUDE: "dev", NEXT_TELEMETRY_DISABLED: "1", GIT_OPTIONAL_LOCKS: "0" };
    for (const name of ["XDG_RUNTIME_DIR", "DBUS_SESSION_BUS_ADDRESS", "SSH_AUTH_SOCK"]) if (process.env[name]) env[name] = process.env[name];
    if (build) { env.MONGODB_URI = ""; env.NEXT_PUBLIC_SITE_URL = this.config.siteUrl; }
    if (install && process.env.GITHUB_PACKAGES_TOKEN) env.GITHUB_PACKAGES_TOKEN = process.env.GITHUB_PACKAGES_TOKEN;
    const budget = new AbortController();
    const callerSignal = recovery || this.recovering ? undefined : this.signal;
    const signal = callerSignal ? AbortSignal.any([callerSignal, budget.signal]) : budget.signal;
    let checking; let budgetError;
    const timer = monitored || build || install ? setInterval(() => {
      if (checking) return;
      checking = this.guard().catch((error) => { budgetError = error; budget.abort(); }).finally(() => { checking = undefined; });
    }, 1000) : undefined;
    let cleanupVerified = false;
    try {
      const result = await this.executeCommand({ command: args, cwd, env, timeoutMs, killGraceMs: this.config.killGraceMs, lockFd: this.lockFd, signal });
      cleanupVerified = true;
      if (budgetError) throw budgetError;
      return result.stdout.replace(/\n$/, "");
    } catch (error) {
      if (!error.cleanupUncertain) cleanupVerified = true;
      throw error;
    } finally {
      clearInterval(timer); await checking;
      // A systemd manager job can outlive its client process. service() owns
      // that sentinel until a separate read-only state/job check completes.
      if (mutating && cleanupVerified && !serviceMutation) await this.clearInflight();
    }
  }
  async noInflight() {
    if (await exists(this.inflightFile)) throw new Error("Unfinished deployment command evidence at recovery/inflight.json; operator must verify all writers and systemd jobs stopped before recovery");
  }
  async clearInflight() { await rm(this.inflightFile); await syncDirectory(this.root); }
  git(args, options) { return this.command(["/usr/bin/git", ...args], options); }
  async service(action, recovery = false) {
    await this.noInflight();
    let clientError;
    try { await this.command(["/usr/bin/systemctl", "--user", action, this.config.service], { timeoutMs: this.config.stopTimeoutMs, recovery }); }
    catch (error) { if (error.cleanupUncertain) throw error; clientError = error; }
    const state = await this.command(["/usr/bin/systemctl", "--user", "show", this.config.service, "--property=ActiveState,MainPID,ControlPID,SubState,Job"], { recovery: true });
    const fields = Object.fromEntries(state.split("\n").map((line) => line.split("=")));
    const idle = fields.Job === "" && fields.ControlPID === "0";
    const stopped = idle && ["inactive", "failed"].includes(fields.ActiveState) && fields.MainPID === "0";
    const started = idle && fields.ActiveState === "active" && /^[1-9]\d*$/.test(fields.MainPID);
    if (action === "stop" ? !stopped : !started && !stopped) throw new Error(`Service ${action} was not verified; unresolved command evidence retained`);
    await this.clearInflight();
    if (clientError) throw clientError;
    if (action === "start" && !started) throw new Error("Service start failed with a verified stopped state");
  }
  async active() {
    const result = await this.command(["/usr/bin/systemctl", "--user", "is-active", this.config.service]);
    if (result !== "active") throw new Error("Current application service is not active");
  }
  async requireStopped() {
    const state = await this.command(["/usr/bin/systemctl", "--user", "show", this.config.service, "--property=ActiveState,MainPID,ControlPID,SubState,Job"], { recovery: true });
    const fields = Object.fromEntries(state.split("\n").map((line) => line.split("=")));
    if (!["inactive", "failed"].includes(fields.ActiveState) || fields.MainPID !== "0" || fields.ControlPID !== "0" || fields.Job !== "") throw new Error("Service unexpectedly active during an incomplete switch; preserve media and inspect manually");
  }
  async healthy(expectedTotal) {
    this.lastOperation = "readiness";
    const deadline = Date.now() + this.config.healthTimeoutMs;
    let last;
    do {
      try { return await this.health(this.config, this.config.appDir, expectedTotal); } catch (error) { last = error; }
      if (Date.now() < deadline) await wait(Math.min(1000, deadline - Date.now()));
    } while (Date.now() < deadline);
    throw new Error(`Readiness failed: ${last?.message}`);
  }
  async guard(initial = false) { return spaceGuard(this.root, this.config.maxManagedBytes, this.config.reserveBytes, { initial }); }
  async paths() {
    await plainPath(this.config.appDir, { directory: true });
    await plainPath(path.join(this.config.appDir, ".git"), { directory: true });
    await plainPath(this.config.stateDir, { directory: true });
    if ((await lstat(this.config.appDir)).dev !== (await lstat(this.config.stateDir)).dev) throw new Error("App and state directories must share a filesystem for atomic promotion");
    for (const file of [this.root, this.transaction, this.snapshot]) await plainPath(file, { missing: true, directory: true });
    for (const relative of [...ARTIFACT_PATHS, ...MANUAL_PATHS]) await plainPath(path.join(this.config.appDir, relative), { missing: true, directory: true });
    for (const name of await readdir(this.config.appDir)) if (name.startsWith(".env") && name !== ".env.example") {
      const file = path.join(this.config.appDir, name);
      await plainPath(file);
      if (!(await lstat(file)).isFile()) throw new Error("Environment configuration must remain a regular file");
    }
    await plainPath(this.marker);
  }
  async sourceClean(cwd = this.config.appDir) {
    if (await exists(path.join(cwd, ".git/index.lock"))) throw new Error("Unexpected Git index lock; operator inspection required");
    const entries = (await this.git(["status", "--porcelain=v1", "-z", "--untracked-files=all", "--ignored=matching"], { cwd })).split("\0").filter(Boolean);
    for (const entry of entries) {
      const code = entry.slice(0, 2); const name = entry.slice(3);
      const manual = MANUAL_PATHS.some((root) => name === `${root}/` || name.startsWith(`${root}/`));
      const generated = code === "!!" && ([".next/", "node_modules/", "next-env.d.ts", "tsconfig.tsbuildinfo"].includes(name) || /^\.env(?:\.[a-zA-Z0-9_-]+)?$/.test(name));
      if ((!manual && !generated) || /[RCU]/.test(code)) throw new Error(`Unexpected dirty source/configuration: ${name}`);
    }
    await inventory(cwd, MANUAL_PATHS, { hash: false });
  }
  async treeSafe(commit) {
    const tree = await this.git(["ls-tree", "-r", "-z", commit]);
    for (const entry of tree.split("\0").filter(Boolean)) {
      const [metadata, name] = entry.split("\t");
      if (!/^(100644|100755) blob [a-f0-9]{40}$/.test(metadata) || (name.split("/").some((part) => part.startsWith(".env") && part !== ".env.example"))) throw new Error("Candidate source contains symlinks, submodules, or environment files");
      if (ARTIFACT_PATHS.some((root) => name === root || name.startsWith(`${root}/`)) || MANUAL_PATHS.some((root) => root === name || root.startsWith(`${name}/`))) throw new Error("Candidate source replaces a protected runtime/media directory");
    }
  }
  async current() {
    const head = await this.git(["rev-parse", "HEAD"]);
    const marker = (await readFile(this.marker, "utf8")).trim();
    if (!sha(head) || head !== marker) throw new Error("Current source and deployed marker disagree");
    await this.sourceClean();
    await this.treeSafe(head);
    for (const name of ARTIFACT_PATHS) if (!await exists(path.join(this.config.appDir, name))) throw new Error("Current runtime artifact missing");
    await inventory(this.config.appDir, ARTIFACT_PATHS, { links: true, hash: false });
    await this.active();
    const total = await this.healthy();
    return { head, total };
  }
  async quickCurrent() {
    if (await exists(path.join(this.config.appDir, ".git/index.lock"))) throw new Error("Unexpected Git index lock; operator inspection required");
    const status = await this.git(["status", "--porcelain=v2", "--branch", "--untracked-files=no"]);
    const lines = status.split("\n").filter(Boolean);
    const identity = lines.find((line) => line.startsWith("# branch.oid "))?.slice("# branch.oid ".length);
    if (!sha(identity) || lines.some((line) => !line.startsWith("# "))) throw new Error("Current tracked source or Git identity changed");
    const marker = (await readFile(this.marker, "utf8")).trim();
    if (identity !== marker) throw new Error("Current source and deployed marker disagree");
    await this.active();
    return identity;
  }
  async remoteMain() {
    const output = await this.git(["ls-remote", "--exit-code", "origin", "refs/heads/main"]);
    const lines = output.split("\n").filter(Boolean);
    if (lines.length !== 1) throw new Error("Remote main lookup returned an unexpected result");
    const [commit, reference, extra] = lines[0].split("\t");
    if (!sha(commit) || reference !== "refs/heads/main" || extra !== undefined) throw new Error("Remote main lookup returned an invalid commit");
    return commit;
  }
  async integritySweepDue(now) {
    if (!now || !/^[a-f0-9-]{36}$/.test(now.bootId) || !Number.isSafeInteger(now.uptimeMs) || now.uptimeMs < 0) throw new Error("Invalid host monotonic clock");
    if (!await exists(this.integritySweepFile)) return true;
    const record = await readJson(this.integritySweepFile);
    if (record.schema !== 1 || !/^[a-f0-9-]{36}$/.test(record.bootId) || !Number.isSafeInteger(record.uptimeMs) || record.uptimeMs < 0) {
      throw new Error("Invalid integrity sweep record");
    }
    return record.bootId !== now.bootId || now.uptimeMs < record.uptimeMs || now.uptimeMs - record.uptimeMs >= this.config.integritySweepMs;
  }
  async recordIntegritySweep(now) {
    await writeJson(this.integritySweepFile, { schema: 1, bootId: now.bootId, uptimeMs: now.uptimeMs });
  }
  async check() {
    await this.paths();
    await this.noInflight();
    const unit = await this.command(["/usr/bin/systemctl", "--user", "show", this.config.service, "--property=WorkingDirectory,ExecStart,KillMode,Restart"]);
    const fields = Object.fromEntries(unit.split("\n").map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]));
    if (fields.WorkingDirectory !== this.config.appDir || fields.KillMode !== "control-group" || fields.Restart !== "on-failure" || !fields.ExecStart?.includes(`${path.dirname(process.execPath)}/npm`)) throw new Error("Application service/runtime contract changed");
    return { outcome: "configuration-valid" };
  }
  async journal(phase, extra = {}) {
    this.pending = { ...this.pending, ...extra, phase };
    await writeJson(this.pendingFile, this.pending);
    await this.checkpoint(`phase:${phase}`, this);
  }
  async copy(from, to, names, links = false) {
    await this.guard();
    const deadline = Date.now() + this.config.copyTimeoutMs;
    const kind = links ? "runtime" : "media";
    this.lastOperation = `${kind}-source-inventory`;
    for (const name of names) await plainPath(path.join(from, name), { directory: true, missing: true });
    await inventory(from, names, { links, hash: false, deadline });
    this.lastOperation = `${kind}-destination-inventory`;
    const result = await copyTrees(from, to, names, { links, deadline,
      copy: async (source, destination) => {
        await this.command(["/bin/cp", "-a", "--reflink=auto", `${source}/.`, destination],
          { timeoutMs: Math.max(1, deadline - Date.now()), recovery: true, monitored: true });
        this.lastOperation = `${kind}-destination-inventory`;
      },
    });
    await this.guard();
    return result;
  }
  async loadPending() {
    const pending = await readJson(this.pendingFile);
    if (pending.schema !== 1 || !/^[a-f0-9-]{36}$/.test(pending.id) || !sha(pending.prior) || !sha(pending.candidate) || !phases.has(pending.phase) ||
        !Number.isSafeInteger(pending.total) || pending.total < this.config.minimumTotal || !["initial", "latest"].includes(pending.media) ||
        pending.appDir !== this.config.appDir || pending.service !== this.config.service) throw new Error("Invalid pending deployment journal");
    this.pending = pending;
  }
  async snapshotManifest() {
    this.lastOperation = "snapshot-verification";
    const deadline = Date.now() + this.config.copyTimeoutMs;
    const manifest = await readJson(path.join(this.snapshot, "manifest.json"));
    if (manifest.schema !== 1 || manifest.id !== this.pending.id || manifest.prior !== this.pending.prior || !Array.isArray(manifest.runtime) || !Array.isArray(manifest.media)) throw new Error("Snapshot does not belong to pending deployment");
    await verifyInventory(path.join(this.snapshot, "runtime"), ARTIFACT_PATHS, manifest.runtime, { links: true, deadline });
    await verifyInventory(path.join(this.snapshot, "media"), MANUAL_PATHS, manifest.media, { deadline });
    return manifest;
  }
  async captureLatest() {
    const temporary = path.join(this.transaction, "media.next");
    const latest = path.join(this.transaction, "media.latest");
    await rm(temporary, { recursive: true, force: true });
    const entries = await this.copy(this.config.appDir, temporary, MANUAL_PATHS);
    await writeJson(path.join(temporary, "manifest.json"), { id: this.pending.id, entries });
    await rm(latest, { recursive: true, force: true });
    await rename(temporary, latest); await syncDirectory(this.transaction);
    // A crash before this phase leaves the live, stopped media intact and can
    // repeat capture. After it, never recapture a partially reset source tree.
    await this.journal("restoring", { media: "latest" });
  }
  async restoreMedia({ overlay = false } = {}) {
    const root = this.pending.media === "latest" ? path.join(this.transaction, "media.latest") : path.join(this.snapshot, "media");
    const manifest = this.pending.media === "latest" ? (await readJson(path.join(root, "manifest.json"))) : { id: this.pending.id, entries: (await this.snapshotManifest()).media };
    if (manifest.id !== this.pending.id) throw new Error("Captured media journal mismatch");
    await verifyInventory(root, MANUAL_PATHS, manifest.entries);
    if (!overlay) for (const name of MANUAL_PATHS) await rm(path.join(this.config.appDir, name), { recursive: true, force: true });
    await this.copy(root, this.config.appDir, MANUAL_PATHS);
    if (overlay) {
      const actual = new Map((await inventory(this.config.appDir, MANUAL_PATHS)).map((entry) => [entry.path, entry]));
      if (manifest.entries.some((entry) => entry.type !== "missing" && JSON.stringify(actual.get(entry.path)) !== JSON.stringify(entry))) throw new Error("Manual media overlay integrity mismatch");
    } else await verifyInventory(this.config.appDir, MANUAL_PATHS, manifest.entries);
  }
  async terminalCleanup() {
    await rm(this.transaction, { recursive: true, force: true });
    await rm(this.pendingFile); await syncDirectory(this.root);
  }
  async recover(failure) {
    this.recovering = true;
    await this.noInflight();
    await this.loadPending();
    this.pending.failure = failure ?? this.pending.failure ?? { phase: this.pending.phase, operation: "interrupted", reason: "interrupted" };
    const { phase, prior, candidate } = this.pending;
    await this.checkpoint("recovery:begin", this);
    if (["committed", "recovered"].includes(phase)) {
      const expected = phase === "committed" ? candidate : prior;
      if (await this.git(["rev-parse", "HEAD"], { recovery: true }) !== expected || (await readFile(this.marker, "utf8")).trim() !== expected) throw new Error("Terminal deployment identity changed");
      await this.current(); await this.terminalCleanup();
      return { outcome: "recovered-terminal", commit: expected };
    }
    if (["staging", "preparing"].includes(phase)) {
      // No source/artifact mutation can precede the switching phase.
      if (await this.git(["rev-parse", "HEAD"], { recovery: true }) !== prior || (await readFile(this.marker, "utf8")).trim() !== prior) throw new Error("Untouched deployment baseline changed");
      await this.sourceClean();
      await this.service("start", true); await this.healthy();
      await rm(this.snapshot, { recursive: true, force: true });
    } else {
      await this.snapshotManifest(); // Fail closed before stopping on damaged evidence.
      const currentHead = await this.git(["rev-parse", "HEAD"], { recovery: true });
      if (![prior, candidate].includes(currentHead)) throw new Error("Pending deployment source identity changed");
      await this.sourceClean();
      if (["switching", "restoring"].includes(phase)) await this.requireStopped();
      await this.service("stop", true);
      if (["running", "restored"].includes(phase)) await this.captureLatest();
      else if (phase !== "restoring") await this.journal("restoring");
      await this.guard();
      const restore = path.join(this.transaction, "restore");
      await rm(restore, { recursive: true, force: true });
      const manifest = await this.snapshotManifest();
      await this.copy(path.join(this.snapshot, "runtime"), restore, ARTIFACT_PATHS, true);
      await verifyInventory(restore, ARTIFACT_PATHS, manifest.runtime, { links: true });
      await this.git(["reset", "--hard", prior], { recovery: true });
      await this.checkpoint("rollback:source", this);
      for (const name of ARTIFACT_PATHS) {
        await rm(path.join(this.config.appDir, name), { recursive: true, force: true });
        await rename(path.join(restore, name), path.join(this.config.appDir, name));
        await syncDirectory(this.config.appDir);
        await this.checkpoint(`rollback:${name}`, this);
      }
      await this.restoreMedia();
      await verifyInventory(this.config.appDir, ARTIFACT_PATHS, manifest.runtime, { links: true });
      await this.journal("restored");
      await this.service("start", true);
      // Catalog writes are not rolled back. A healthy fresh total is valid
      // when restoring old code, even if it differs from preflight's total.
      await this.healthy();
      await atomicWrite(this.marker, `${prior}\n`);
    }
    await writeJson(this.failedFile, { schema: 1, commit: candidate, time: new Date().toISOString(), failure: this.pending.failure });
    await this.journal("recovered");
    await this.terminalCleanup();
    return { outcome: "rolled-back", commit: prior, failedCommit: candidate };
  }
  async deploy({ force = false } = {}) {
    await this.check();
    await mkdir(this.root, { mode: 0o700, recursive: true });
    await syncDirectory(this.config.stateDir);
    // Recovery must not depend on fetch, ordinary healthy preflight, or marker
    // short circuits. Even a marker already naming candidate is not success.
    if (await exists(this.pendingFile)) return this.recover();
    if (await exists(this.transaction)) throw new Error("Unowned deployment transaction directory");
    let observedRemote;
    if (!force) {
      const quickHead = await this.quickCurrent();
      observedRemote = await this.remoteMain();
      if (observedRemote === quickHead) {
        const now = await this.integrityClock();
        if (!await this.integritySweepDue(now)) return { outcome: "current", commit: quickHead };
      }
    }
    const before = await this.current();
    await this.recordIntegritySweep(await this.integrityClock());
    if (!force && observedRemote === before.head) return { outcome: "current", commit: before.head };
    await this.git(["fetch", "--prune", "origin", "main"]);
    const candidate = await this.git(["rev-parse", "refs/remotes/origin/main"]);
    if (!sha(candidate)) throw new Error("Invalid fetched candidate commit");
    if (!force && candidate === before.head) return { outcome: "current", commit: candidate };
    if (await exists(this.failedFile)) {
      const failed = await readJson(this.failedFile);
      if (failed.schema !== 1 || !sha(failed.commit)) throw new Error("Invalid failed-deployment record");
      if (!force && failed.commit === candidate) return { outcome: "suppressed", commit: candidate };
    }
    await this.treeSafe(candidate); await this.guard(true);
    // Only the recovery snapshot owned by this implementation is replaced.
    // Operator-maintained backups outside recovery/ are never touched.
    if (await exists(this.snapshot)) {
      const old = await readJson(path.join(this.snapshot, "manifest.json"));
      if (old.schema !== 1 || !sha(old.prior)) throw new Error("Unknown recovery snapshot");
    }
    this.pending = { schema: 1, id: randomUUID(), prior: before.head, candidate, total: before.total,
      appDir: this.config.appDir, service: this.config.service, media: "initial", phase: "staging" };
    await this.journal("staging");
    try {
      await rm(this.snapshot, { recursive: true, force: true });
      await mkdir(this.transaction, { mode: 0o700 });
      await this.git(["clone", "--no-hardlinks", "--no-checkout", this.config.appDir, this.stage], { cwd: this.transaction, monitored: true });
      await this.git(["checkout", "--detach", candidate], { cwd: this.stage });
      await this.checkpoint("stage:checkout", this);
      const npm = path.join(path.dirname(process.execPath), "npm");
      await this.command([npm, "ci", "--no-audit", "--no-fund"], { cwd: this.stage, install: true, timeoutMs: this.config.installTimeoutMs });
      await this.guard(); await this.checkpoint("stage:install", this);
      await this.command([npm, "run", "build"], { cwd: this.stage, build: true, timeoutMs: this.config.buildTimeoutMs });
      this.lastOperation = "stage-artifact-inventory";
      for (const name of ARTIFACT_PATHS) await plainPath(path.join(this.stage, name), { directory: true });
      await inventory(this.stage, ARTIFACT_PATHS, { links: true, sync: true, deadline: Date.now() + this.config.copyTimeoutMs });
      await syncDirectory(this.stage);
      await this.sourceClean(this.stage);
      for (const name of ARTIFACT_PATHS) if (!await exists(path.join(this.stage, name))) throw new Error("Staging build artifact missing");
      await this.guard(); await this.checkpoint("stage:build", this);
      const again = await this.current();
      if (again.head !== before.head || again.total !== before.total) throw new Error("Deployment baseline changed while staging");
      await this.git(["update-ref", "refs/piugame-deploy/rollback", before.head]);
      await this.journal("preparing");
      await this.service("stop");
      await mkdir(this.snapshot, { mode: 0o700 });
      const runtime = await this.copy(this.config.appDir, path.join(this.snapshot, "runtime"), ARTIFACT_PATHS, true);
      const media = await this.copy(this.config.appDir, path.join(this.snapshot, "media"), MANUAL_PATHS);
      await writeJson(path.join(this.snapshot, "manifest.json"), { schema: 1, id: this.pending.id, prior: before.head, runtime, media });
      await this.snapshotManifest(); await this.journal("switching");
      await this.git(["reset", "--hard", candidate]);
      await this.checkpoint("switch:source", this);
      for (const name of ARTIFACT_PATHS) {
        await rm(path.join(this.config.appDir, name), { recursive: true, force: true });
        await rename(path.join(this.stage, name), path.join(this.config.appDir, name));
        await syncDirectory(this.config.appDir);
        await this.checkpoint(`switch:${name}`, this);
      }
      await this.restoreMedia({ overlay: true });
      await this.journal("running");
      await this.service("start");
      await this.healthy(before.total);
      this.lastOperation = "marker";
      await atomicWrite(this.marker, `${candidate}\n`);
      await this.checkpoint("marker:written", this);
      await this.journal("committed");
      await rm(this.failedFile, { force: true });
      await this.terminalCleanup();
      return { outcome: "deployed", commit: candidate };
    } catch (error) {
      if (error.cleanupUncertain) throw error;
      const failure = { phase: this.pending.phase, operation: this.lastOperation ?? "filesystem",
        reason: /timed out/i.test(error.message) ? "timeout" : /abort/i.test(error.message) ? "aborted" :
          /storage|space/i.test(error.message) ? "storage-limit" : /Readiness|Catalog total/i.test(error.message) ? "readiness" :
            /integrity|symlink|boundary/i.test(error.message) ? "integrity" : "operation-failed",
        ...(Number.isInteger(error.exitCode) ? { exitCode: error.exitCode } : {}) };
      const result = await this.recover(failure);
      return { ...result, failure };
    }
  }
}

async function main() {
  let force = false; let check = false; let configFile;
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--force") force = true;
    else if (args[i] === "--check") check = true;
    else if (args[i] === "--config" && args[i + 1]) configFile = args[++i];
    else throw new Error("Usage: deploy-web.mjs [--check] [--force] [--config /absolute/config.json]");
  }
  if (process.platform !== "linux") throw new Error("Host deployment requires Linux systemd and flock");
  const config = configuration(configFile ? await readJson(configFile) : {});
  if (!check) for (const name of ["deploy-web.mjs", "deploy-command.mjs", "deploy-files.mjs"]) {
    const file = fileURLToPath(new URL(name, import.meta.url));
    await plainPath(file);
    if (!(await lstat(file)).isFile() || inside(config.appDir, file) || inside(path.join(config.stateDir, "recovery"), file)) throw new Error("Mutating deployment requires an immutable bundle outside the application and recovery directories");
  }
  const controller = new AbortController();
  process.on("SIGTERM", () => controller.abort()); process.on("SIGINT", () => controller.abort());
  let result;
  if (check) {
    // /dev/null supplies the inherited guardian descriptor without creating or
    // acquiring a deployment lock during nonmutating config validation.
    const descriptor = await open("/dev/null", "r");
    try { result = await new Deployment(config, { lockFd: descriptor.fd }).check(); } finally { await descriptor.close(); }
  } else {
    result = await withDeployLock(config.stateDir, (lockFd) => new Deployment(config, { lockFd, signal: controller.signal }).deploy({ force }));
  }
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (result.outcome === "rolled-back") process.exitCode = 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => { process.stderr.write(`Deployment stopped: ${error.message}\n`); process.exitCode = 1; });
}
