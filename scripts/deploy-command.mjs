import { spawn } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const helper = fileURLToPath(import.meta.url);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Only live groups created in this process tree are accepted. No persisted PID
// is ever used to kill a process on a subsequent deployment.
export async function groupAlive(pgid, excludePid) {
  if (process.platform === "linux") {
    for (const name of await readdir("/proc")) {
      if (!/^\d+$/.test(name)) continue;
      if (Number(name) === excludePid) continue;
      try {
        const stat = await readFile(`/proc/${name}/stat`, "utf8");
        const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
        if (Number(fields[2]) === pgid && fields[0] !== "Z" && fields[0] !== "X") return true;
      } catch (error) {
        if (error.code !== "ENOENT" && error.code !== "ESRCH") throw error;
      }
    }
    return false;
  }
  // macOS is supported for disposable process tests, not host installation.
  const listing = await new Promise((resolve, reject) => {
    const child = spawn("/bin/ps", ["-axo", "pid=,pgid=,stat="], { stdio: ["ignore", "pipe", "ignore"] });
    let out = "";
    child.stdout.on("data", (chunk) => { out += chunk; });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve(out) : reject(new Error("Cannot inspect process groups")));
  });
  return listing.split("\n").some((line) => {
    const [pid, group, state] = line.trim().split(/\s+/);
    return Number(pid) !== excludePid && Number(group) === pgid && !state.startsWith("Z");
  });
}

function signalGroup(pgid, signal) {
  try { process.kill(-pgid, signal); } catch (error) { if (error.code !== "ESRCH") throw error; }
}

export async function stopGroup(pgid, graceMs) {
  signalGroup(pgid, "SIGTERM");
  const deadline = Date.now() + graceMs;
  while (await groupAlive(pgid)) {
    if (Date.now() >= deadline || !await groupAlive(pgid, pgid)) signalGroup(pgid, "SIGKILL");
    // Keep the inherited lock if a kernel-blocked process cannot be killed.
    // Releasing it on a timer would allow another deployment to race a writer.
    await sleep(25);
  }
}

/** Run one bounded command under two live guardians. lockFd stays inherited
 * until its entire process group has stopped, including on either guardian's
 * unexpected death. onGroup is a test/diagnostic callback, never persisted. */
export function runCommand({ command, cwd, env = process.env, timeoutMs = 60_000,
  killGraceMs = 1_000, lockFd, signal, onGroup, maxOutputBytes = 4 * 1024 * 1024 }) {
  if (!Array.isArray(command) || !command.length || !Number.isInteger(lockFd)) {
    throw new Error("Command and an open deployment lock descriptor are required");
  }
  return new Promise((resolve, reject) => {
    let pgid;
    let outcome;
    const stdoutChunks = [];
    const stderrChunks = [];
    let outputBytes = 0;
    let failure;
    const child = spawn(process.execPath, [helper, "--supervisor"], {
      stdio: ["ignore", "pipe", "pipe", lockFd, "ipc"],
    });
    const abort = () => { failure ??= new Error("Deployment command aborted"); child.send?.({ type: "abort" }, () => {}); };
    const capture = (name, chunk) => {
      outputBytes += chunk.length;
      if (outputBytes > maxOutputBytes) {
        failure ??= new Error("Deployment command output exceeded its limit");
        abort();
      } else if (name === "stdout") stdoutChunks.push(chunk); else stderrChunks.push(chunk);
    };
    child.stdout.on("data", (chunk) => capture("stdout", chunk));
    child.stderr.on("data", (chunk) => capture("stderr", chunk));
    child.on("error", (error) => { failure ??= error; });
    child.on("message", (message) => {
      if (message.type === "group") {
        pgid = message.pgid;
        onGroup?.({ pgid, supervisorPid: child.pid });
        child.send({ type: "go", command, cwd, env }, () => {});
      } else if (message.type === "result") outcome = message;
      else if (message.type === "uncertain") {
        const error = new Error("Command cleanup cannot be verified; deployment lock retained by supervisor");
        error.cleanupUncertain = true;
        reject(error);
      }
    });
    child.on("close", async () => {
      signal?.removeEventListener("abort", abort);
      const stdout = Buffer.concat(stdoutChunks).toString("utf8");
      const stderr = Buffer.concat(stderrChunks).toString("utf8");
      try {
        // Supervisor SIGKILL: the driver already knows the group before any
        // actual command can start, and retains its own lock during cleanup.
        if (pgid && !outcome?.cleanupVerified) {
          try { await stopGroup(pgid, killGraceMs); }
          catch (error) { error.cleanupUncertain = true; throw error; }
        }
        if (failure) throw failure;
        if (!outcome || outcome.code !== 0) {
          const error = new Error(outcome?.reason ?? `Command failed (${outcome?.code ?? "supervisor exited"}): ${command[0]}`);
          error.stdout = stdout; error.stderr = stderr; error.exitCode = outcome?.code;
          throw error;
        }
        resolve({ stdout, stderr });
      } catch (error) { reject(error); }
    });
    child.send({ type: "init", timeoutMs, killGraceMs }, () => {});
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
  });
}

async function supervise() {
  let group;
  let config;
  let finished = false;
  let timer;
  const finish = async (result) => {
    if (finished) return;
    finished = true;
    clearTimeout(timer);
    try { if (group?.pid) await stopGroup(group.pid, config.killGraceMs); }
    catch {
      // Do not release the lock or report a normal failed command while a
      // writer may still exist. Operator inspection is required.
      if (process.connected) process.send({ type: "uncertain" });
      setInterval(() => {}, 60_000);
      return;
    }
    if (process.connected) await new Promise((resolve) => process.send({ type: "result", ...result, cleanupVerified: true }, resolve));
    process.exit(0);
  };
  process.on("disconnect", () => { void finish({ code: 1, reason: "Driver disconnected" }); });
  process.on("SIGTERM", () => { void finish({ code: 1, reason: "Supervisor terminated" }); });
  process.on("SIGINT", () => { void finish({ code: 1, reason: "Supervisor interrupted" }); });
  process.on("message", (message) => {
    if (finished) return;
    if (message.type === "init") {
      config = message;
      group = spawn(process.execPath, [helper, "--group"], {
        detached: true, stdio: ["ignore", "inherit", "inherit", 3, "ipc"],
      });
      group.on("error", () => { void finish({ code: 1, reason: "Cannot start command group" }); });
      group.on("message", (result) => { if (result.type === "result") void finish(result); });
      group.on("exit", () => { void finish({ code: 1, reason: "Command group exited unexpectedly" }); });
      process.send({ type: "group", pgid: group.pid });
      timer = setTimeout(() => { void finish({ code: 1, reason: "Deployment command timed out" }); }, config.timeoutMs);
    } else if (message.type === "go" && !finished) {
      group.send(message);
    } else if (message.type === "abort") void finish({ code: 1, reason: "Deployment command aborted" });
  });
}

function bootstrap() {
  // A supervisor can die before reporting our identity. Until GO, no command
  // exists; after GO, the driver knows our group and also guards its cleanup.
  process.on("disconnect", () => signalGroup(process.pid, "SIGKILL"));
  // Keep the inherited lock/disconnect guardian alive during the TERM grace
  // period. Otherwise losing both outer guardians could leave a resistant
  // grandchild alive after its default-TERM parent released the last lock FD.
  process.on("SIGTERM", () => {});
  process.once("message", ({ command, cwd, env }) => {
    const child = spawn(command[0], command.slice(1), {
      cwd, env, stdio: ["ignore", "inherit", "inherit", 3],
    });
    child.on("error", () => { if (process.connected) process.send({ type: "result", code: 1, reason: "Cannot spawn command" }); });
    child.on("exit", (code, signal) => {
      if (process.connected) process.send({ type: "result", code: code ?? 1, reason: signal ? `Command received ${signal}` : undefined });
    });
  });
}

if (process.argv[1] === helper) {
  if (process.argv[2] === "--supervisor") await supervise();
  else if (process.argv[2] === "--group") bootstrap();
}
