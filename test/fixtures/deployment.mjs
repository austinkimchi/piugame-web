import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { cp, mkdir, mkdtemp, open, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Deployment, configuration, withDeployLock } from "../../scripts/deploy-web.mjs";
import { MANUAL_PATHS, exists } from "../../scripts/deploy-files.mjs";

const exec = promisify(execFile);
export const git = async (cwd, ...args) => (await exec("/usr/bin/git", ["-c", "core.hooksPath=/dev/null", "-c", "commit.gpgsign=false", ...args], {
  cwd, env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null" }, timeout: 10_000,
})).stdout.trim();
export async function write(file, contents) { await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, contents); }
export async function build(root, version) {
  await write(path.join(root, ".next/BUILD_ID"), version);
  await write(path.join(root, ".next/static/main.js"), `build-${version}`);
  await write(path.join(root, "node_modules/package/index.js"), `dependency-${version}`);
  await mkdir(path.join(root, "node_modules/.bin"), { recursive: true });
  const link = path.join(root, "node_modules/.bin/package");
  if (!await exists(link)) await symlink("../package/index.js", link);
}
export async function fixture(t, { missingManualPath } = {}) {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), "piu-deploy-test-")));
  t.after(() => rm(root, { recursive: true, force: true }));
  const origin = path.join(root, "origin"); const app = path.join(root, "app"); const state = path.join(root, "state");
  await mkdir(origin); await mkdir(state);
  await git(origin, "init", "-b", "main");
  await git(origin, "config", "user.email", "test@example.invalid"); await git(origin, "config", "user.name", "Deployment test");
  await write(path.join(origin, "app.txt"), "old");
  await write(path.join(origin, ".gitignore"), ".env\n.next/\nnode_modules/\n");
  await write(path.join(origin, "package.json"), "{}\n");
  for (const name of MANUAL_PATHS) if (name !== missingManualPath) await write(path.join(origin, name, "tracked % clip.wav"), "curated-original");
  await git(origin, "add", "."); await git(origin, "commit", "-m", "initial");
  const prior = await git(origin, "rev-parse", "HEAD");
  await git(root, "clone", origin, app);
  await write(path.join(app, ".env"), "PRIVATE_SENTINEL_DO_NOT_COPY=fixture-only\n");
  await build(app, "old"); await write(path.join(state, "deployed-commit"), `${prior}\n`);
  await write(path.join(origin, "app.txt"), "new");
  for (const name of MANUAL_PATHS) await write(path.join(origin, name, "tracked % clip.wav"), "candidate-must-not-overwrite-export");
  for (const name of MANUAL_PATHS) await write(path.join(origin, name, "new-source-clip.wav"), "new-reviewed-source-clip");
  await git(origin, "add", "."); await git(origin, "commit", "-m", "candidate");
  const candidate = await git(origin, "rev-parse", "HEAD");
  await write(path.join(root, "service.json"), JSON.stringify({ active: true, total: 675 }));
  const config = configuration({ appDir: app, stateDir: state, healthTimeoutMs: 30, commandTimeoutMs: 5000, installTimeoutMs: 5000,
    buildTimeoutMs: 5000, copyTimeoutMs: 5000, maxManagedBytes: 8 * 1024 * 1024, reserveBytes: 1 });
  await write(path.join(root, "config.json"), JSON.stringify(config));
  return { root, origin, app, state, prior, candidate, config };
}

export async function testDeployment(f, options = {}) {
  const calls = []; const serviceFile = path.join(f.root, "service.json");
  const state = async () => JSON.parse(await readFile(serviceFile, "utf8"));
  const command = async ({ command: args, cwd, env, signal }) => {
    calls.push(args);
    if (signal?.aborted) throw new Error("Command aborted");
    await options.beforeCommand?.(args, cwd, env);
    let stdout = "";
    if (args[0] === "/usr/bin/git") {
      const result = await exec(args[0], args.slice(1), { cwd, env: { ...env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null" }, timeout: 5000 });
      stdout = result.stdout;
    } else if (args[0] === "/bin/cp") {
      if (process.platform === "linux") await exec(args[0], args.slice(1), { cwd, timeout: 5000 });
      else await cp(args.at(-2), args.at(-1), { recursive: true, preserveTimestamps: true, verbatimSymlinks: true });
    } else if (args[0].endsWith("/npm")) {
      if (args[1] === "ci") await mkdir(path.join(cwd, "node_modules"));
      else await build(cwd, (await readFile(path.join(cwd, "app.txt"), "utf8")).trim());
    } else if (args[0] === "/usr/bin/systemctl") {
      const service = await state();
      if (args[2] === "start") service.active = true;
      else if (args[2] === "stop") service.active = false;
      else if (args[2] === "is-active") { if (!service.active) throw new Error("Inactive service"); stdout = "active\n"; }
      else if (args[2] === "show" && args.at(-1).includes("WorkingDirectory")) stdout = `WorkingDirectory=${f.app}\nExecStart=${path.dirname(process.execPath)}/npm run start\nKillMode=control-group\nRestart=on-failure\n`;
      else stdout = `ActiveState=${service.active ? "active" : "inactive"}\nMainPID=${service.active ? "123" : "0"}\nControlPID=0\nSubState=${service.active ? "running" : "dead"}\n`;
      await writeFile(serviceFile, JSON.stringify(service));
    } else throw new Error(`Unknown test command ${args[0]}`);
    await options.afterCommand?.(args, cwd);
    return { stdout, stderr: "" };
  };
  const health = async (_config, root, expectedTotal) => {
    const service = await state();
    if (!service.active) throw new Error("Service stopped");
    const version = (await readFile(path.join(root, "app.txt"), "utf8")).trim();
    if ((await readFile(path.join(root, ".next/BUILD_ID"), "utf8")) !== version ||
        (await readFile(path.join(root, "node_modules/package/index.js"), "utf8")) !== `dependency-${version}`) throw new Error("Mixed runtime");
    await options.health?.(version, service);
    if (service.total < 300 || (expectedTotal !== undefined && service.total !== expectedTotal)) throw new Error("Catalog readiness mismatch");
    return service.total;
  };
  const deployment = new Deployment(f.config, { command, health, checkpoint: options.checkpoint, signal: options.signal, lockFd: options.lockFd ?? 42 });
  return { deployment, calls, state };
}

if (process.argv[1] === fileURLToPath(import.meta.url) && process.argv[2]) {
  const root = process.argv[2];
  const config = JSON.parse(await readFile(path.join(root, "config.json"), "utf8"));
  const f = { root, config, app: config.appDir, state: config.stateDir };
  const run = async (lockFd) => {
    const { deployment } = await testDeployment(f, { lockFd, checkpoint: async (name) => {
      if (name === process.argv[3]) {
        if (process.env.TEST_LATEST_MEDIA === "1") for (const relative of MANUAL_PATHS) {
          await write(path.join(f.app, relative, "tracked % clip.wav"), "fresh-during-health");
          await write(path.join(f.app, relative, "new-hash-upload.wav"), "new-during-health");
        }
        process.kill(process.pid, "SIGKILL");
      }
    } });
    const result = await deployment.deploy({ force: process.argv.includes("--force") });
    process.stdout.write(`${JSON.stringify(result)}\n`);
  };
  if (process.platform === "linux") await withDeployLock(config.stateDir, run);
  else { const handle = await open(path.join(config.stateDir, "deploy.lock"), "a"); try { await run(handle.fd); } finally { await handle.close(); } }
}
