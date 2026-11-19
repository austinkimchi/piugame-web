import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, open, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runCommand } from '../scripts/deploy-command.mjs';

const execFileAsync = promisify(execFile);
const helperUrl = new URL('../scripts/deploy-command.mjs', import.meta.url).href;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const posix = process.platform === 'darwin' || process.platform === 'linux';
const pythonAvailable = posix && spawnSync('python3', ['-c', 'import fcntl'], { timeout: 3000, stdio: 'ignore' }).status === 0;

test('Linux process supervision tests require the kernel-lock probe prerequisite', { skip: process.platform !== 'linux' }, () => {
  assert.equal(pythonAvailable, true, 'Linux CI must provide Python 3 with fcntl; skipping the real-lock tests would leave supervision unverified');
});

async function until(predicate, description, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await pause(25);
  }
  assert.fail(`Timed out waiting for ${description}`);
}

async function optionalRead(filename) {
  try { return await readFile(filename, 'utf8'); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

function kill(pid, signal = 'SIGKILL') {
  try { process.kill(pid, signal); }
  catch (error) { if (error.code !== 'ESRCH') throw error; }
}

// Inspect independently of the helper's groupAlive implementation. Zombies
// cannot write or retain a file descriptor and are excluded on both hosts.
async function liveGroup(pgid) {
  const { stdout } = await execFileAsync('ps', ['-axo', 'pid=,pgid=,stat='], { timeout: 2000 });
  return stdout.split('\n').some(line => {
    const [, group, state] = line.trim().split(/\s+/);
    return Number(group) === pgid && state && !/^[ZX]/.test(state);
  });
}

function observe(promise) {
  // Attach the rejection handler immediately: timeout/abort can happen while
  // the test is waiting for the disposable writer's readiness handshake.
  return promise.then(value => ({ ok: true, value }), error => ({ ok: false, error }));
}

async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'mypiu-command-test-'));
  const lockPath = path.join(root, 'deploy.lock');
  const lock = await open(lockPath, 'a+', 0o600);
  const groups = new Set();
  const supervisors = new Set();
  const drivers = [];
  const metadataPath = path.join(root, 'group.json');
  const paths = Object.fromEntries(['parentReady', 'grandchildReady', 'parentWrites', 'grandchildWrites', 'result'].map(name => [name, path.join(root, name)]));
  const remember = ({ pgid, supervisorPid }) => { groups.add(pgid); supervisors.add(supervisorPid); };
  t.after(async () => {
    // A failed assertion must not leave a TERM-resistant test process behind.
    const metadata = await optionalRead(metadataPath);
    if (metadata) remember(JSON.parse(metadata));
    for (const pgid of groups) kill(-pgid);
    for (const pid of supervisors) kill(pid);
    for (const { child } of drivers) if (child.exitCode === null && child.signalCode === null) kill(child.pid);
    await Promise.all(drivers.map(({ closed }) => closed));
    await lock.close();
    await rm(root, { recursive: true, force: true });
  });
  const grandchild = `
    const fs = require('node:fs');
    process.on('SIGTERM', () => {});
    fs.writeFileSync(${JSON.stringify(paths.grandchildReady)}, String(process.pid));
    setInterval(() => fs.appendFileSync(${JSON.stringify(paths.grandchildWrites)}, 'g'), 15);
  `;
  const writerPath = path.join(root, 'writer.cjs');
  await writeFile(writerPath, `
    const fs = require('node:fs');
    const { spawn } = require('node:child_process');
    process.on('SIGTERM', () => {});
    const child = spawn(process.execPath, ['-e', ${JSON.stringify(grandchild)}], { stdio: 'ignore' });
    fs.writeFileSync(${JSON.stringify(paths.parentReady)}, JSON.stringify({ pid: process.pid, child: child.pid }));
    setInterval(() => fs.appendFileSync(${JSON.stringify(paths.parentWrites)}, 'p'), 15);
  `);
  return { root, lockPath, lock, groups, supervisors, drivers, metadataPath, paths, remember, writerPath };
}

async function writersReady(f) {
  await until(async () => (await optionalRead(f.paths.parentReady)) && (await optionalRead(f.paths.grandchildReady)) && (await optionalRead(f.paths.parentWrites)) && (await optionalRead(f.paths.grandchildWrites)), 'both TERM-resistant writers');
}

async function assertStopped(f) {
  for (const pgid of f.groups) await until(async () => !(await liveGroup(pgid)), `process group ${pgid} to stop`);
  const before = await Promise.all([optionalRead(f.paths.parentWrites), optionalRead(f.paths.grandchildWrites)]);
  await pause(100);
  const after = await Promise.all([optionalRead(f.paths.parentWrites), optionalRead(f.paths.grandchildWrites)]);
  assert.deepEqual(after, before, 'no writes may continue after command cleanup completes');
}

function options(f, overrides = {}) {
  return {
    command: [process.execPath, f.writerPath], cwd: f.root, lockFd: f.lock.fd,
    timeoutMs: 5000, killGraceMs: 150, onGroup: f.remember, ...overrides,
  };
}

function lockAvailable(lockPath) {
  const result = spawnSync('python3', ['-c', `
import fcntl, os, sys
fd = os.open(sys.argv[1], os.O_RDWR)
try:
    fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
except BlockingIOError:
    sys.exit(73)
`, lockPath], { timeout: 3000, encoding: 'utf8' });
  assert.ifError(result.error);
  assert.ok(result.status === 0 || result.status === 73, result.stderr || `Unexpected lock-probe status ${result.status}`);
  return result.status === 0;
}

async function startLockedDriver(f, overrides = {}) {
  const driverPath = path.join(f.root, 'driver.mjs');
  await writeFile(driverPath, `
    import { writeFileSync, closeSync } from 'node:fs';
    import { runCommand } from ${JSON.stringify(helperUrl)};
    const result = await runCommand({
      command: [process.execPath, ${JSON.stringify(f.writerPath)}], cwd: ${JSON.stringify(f.root)},
      lockFd: 3, timeoutMs: 10000, killGraceMs: 1000, ...${JSON.stringify(overrides)},
      onGroup: group => writeFileSync(${JSON.stringify(f.metadataPath)}, JSON.stringify(group)),
    }).then(() => ({ ok: true }), error => ({ ok: false, message: error.message, cleanupUncertain: error.cleanupUncertain ?? false }));
    writeFileSync(${JSON.stringify(f.paths.result)}, JSON.stringify(result));
    closeSync(3);
  `);
  // Python only supplies the kernel flock unavailable in Node's standard
  // library. exec replaces it with the real Node driver, preserving FD 3.
  const child = spawn('python3', ['-c', `
import fcntl, os, sys
fd = os.open(sys.argv[1], os.O_CREAT | os.O_RDWR, 0o600)
fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
os.dup2(fd, 3, inheritable=True)
os.set_inheritable(3, True)
if fd != 3:
    os.close(fd)
os.execv(sys.argv[2], [sys.argv[2], sys.argv[3]])
`, f.lockPath, process.execPath, driverPath], { stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', chunk => { output += chunk; });
  child.stderr.on('data', chunk => { output += chunk; });
  const closed = new Promise((resolve, reject) => { child.once('error', reject); child.once('close', (code, signal) => resolve({ code, signal })); });
  f.drivers.push({ child, closed });
  await until(async () => {
    assert.equal(child.exitCode, null, `Driver exited early: ${output}`);
    const text = await optionalRead(f.metadataPath);
    if (!text) return false;
    f.remember(JSON.parse(text));
    return true;
  }, 'driver group handshake');
  await writersReady(f);
  assert.equal(lockAvailable(f.lockPath), false, 'the active deployment must own the kernel lock');
  return { child, closed, metadata: JSON.parse(await readFile(f.metadataPath, 'utf8')) };
}

test('command timeout kills TERM-resistant child and grandchild before rejecting', { skip: !posix, timeout: 10000 }, async t => {
  const f = await fixture(t);
  const started = Date.now();
  const result = observe(runCommand(options(f, { timeoutMs: 2000 })));
  await writersReady(f);
  const outcome = await result;
  assert.equal(outcome.ok, false);
  assert.match(outcome.error.message, /timed out/);
  assert.ok(Date.now() - started < 5000, 'TERM resistance must not turn a timeout into an indefinite wait');
  await assertStopped(f);
});

test('abort kills the entire resistant command group before settling', { skip: !posix, timeout: 10000 }, async t => {
  const f = await fixture(t);
  const controller = new AbortController();
  const result = observe(runCommand(options(f, { signal: controller.signal })));
  await writersReady(f);
  controller.abort();
  const outcome = await result;
  assert.equal(outcome.ok, false);
  assert.match(outcome.error.message, /aborted/);
  await assertStopped(f);
});

test('driver SIGKILL retains flock until its supervisor stops resistant writers', { skip: !pythonAvailable, timeout: 12000 }, async t => {
  const f = await fixture(t);
  const { child, closed } = await startLockedDriver(f);
  kill(child.pid);
  // close waits for inherited output pipes too, so inspect the killed driver's
  // exit event rather than waiting for supervisor cleanup to close those pipes.
  await until(() => child.signalCode === 'SIGKILL', 'driver SIGKILL');
  assert.equal(lockAvailable(f.lockPath), false, 'supervisor must retain the lock through the TERM grace period');
  assert.ok(await liveGroup([...f.groups][0]), 'resistant writers exercise lock retention while still alive');
  await assertStopped(f);
  await closed;
  await until(() => lockAvailable(f.lockPath), 'lock release after orphan cleanup');
});

test('supervisor SIGKILL cannot release flock with live command writers', { skip: !pythonAvailable, timeout: 12000 }, async t => {
  const f = await fixture(t);
  const { closed, metadata } = await startLockedDriver(f);
  kill(metadata.supervisorPid);
  await until(async () => Boolean(await optionalRead(f.paths.result)), 'driver cleanup result');
  const result = JSON.parse(await readFile(f.paths.result, 'utf8'));
  assert.equal(result.ok, false);
  assert.equal(result.cleanupUncertain, false);
  await assertStopped(f);
  await closed;
  assert.equal(lockAvailable(f.lockPath), true);
});

test('loss of driver and supervisor still shuts down the acknowledged command group', { skip: !pythonAvailable, timeout: 12000 }, async t => {
  const f = await fixture(t);
  const { child, closed, metadata } = await startLockedDriver(f);
  kill(metadata.supervisorPid);
  kill(child.pid);
  await assertStopped(f);
  await closed;
  await until(() => lockAvailable(f.lockPath), 'lock release after both guardians exit');
});

test('supervisor death during orphan cleanup never unlocks ahead of a resistant grandchild', { skip: !pythonAvailable, timeout: 12000 }, async t => {
  const f = await fixture(t);
  // Model npm exiting on TERM while a spawned build process remains alive.
  // The grandchild deliberately has no inherited lock descriptor.
  const writer = await readFile(f.writerPath, 'utf8');
  await writeFile(f.writerPath, writer.replace("process.on('SIGTERM', () => {});", ''));
  const { child, closed, metadata } = await startLockedDriver(f, { killGraceMs: 1500 });
  const { pid: parentPid } = JSON.parse(await readFile(f.paths.parentReady, 'utf8'));
  kill(child.pid);
  await until(async () => {
    const { stdout } = await execFileAsync('ps', ['-axo', 'pid=,stat='], { timeout: 2000 });
    return !stdout.split('\n').some(line => {
      const [pid, state] = line.trim().split(/\s+/);
      return Number(pid) === parentPid && state && !/^[ZX]/.test(state);
    });
  }, 'TERM-sensitive command parent to exit');
  assert.ok(await liveGroup(metadata.pgid), 'the resistant grandchild must still exercise the cleanup window');
  kill(metadata.supervisorPid);
  await pause(100);
  const unlocked = lockAvailable(f.lockPath);
  const writerAlive = await liveGroup(metadata.pgid);
  assert.ok(!(unlocked && writerAlive), 'a subsequent deployment could acquire the lock while the orphan grandchild still writes');
  await assertStopped(f);
  await closed;
  await until(() => lockAvailable(f.lockPath), 'lock release after interrupted orphan cleanup');
});

test('split UTF-8 is decoded after complete bytes arrive on each output stream', { skip: !posix, timeout: 10000 }, async t => {
  const f = await fixture(t);
  const script = `
    process.stdout.write(Buffer.from([0xe9]));
    process.stderr.write(Buffer.from([0xf0, 0x9f]));
    setTimeout(() => {
      process.stdout.write(Buffer.from([0x9b, 0xaa]));
      process.stderr.write(Buffer.from([0x8e, 0xb5]));
    }, 80);
  `;
  const result = await runCommand(options(f, { command: [process.execPath, '-e', script], maxOutputBytes: 7 }));
  assert.deepEqual(result, { stdout: '雪', stderr: '🎵' });
});

test('output cap accepts the exact combined byte boundary and rejects one byte more', { skip: !posix, timeout: 10000 }, async t => {
  const f = await fixture(t);
  const command = [process.execPath, '-e', `process.stdout.write('雪'); process.stderr.write('🎵');`];
  assert.deepEqual(await runCommand(options(f, { command, maxOutputBytes: 7 })), { stdout: '雪', stderr: '🎵' });
  await assert.rejects(runCommand(options(f, { command, maxOutputBytes: 6 })), /output exceeded/);
  await assertStopped(f);
});

test('output overflow stops a resistant writer and its grandchild', { skip: !posix, timeout: 10000 }, async t => {
  const f = await fixture(t);
  const original = await readFile(f.writerPath, 'utf8');
  await writeFile(f.writerPath, `${original}\n
    const outputTimer = setInterval(() => {
      if (fs.existsSync(${JSON.stringify(f.paths.parentWrites)}) && fs.existsSync(${JSON.stringify(f.paths.grandchildWrites)})) {
        clearInterval(outputTimer);
        process.stdout.write(Buffer.alloc(65, 120));
      }
    }, 10);
  `);
  const result = observe(runCommand(options(f, { maxOutputBytes: 64 })));
  await writersReady(f);
  const outcome = await result;
  assert.equal(outcome.ok, false);
  assert.match(outcome.error.message, /output exceeded/);
  await assertStopped(f);
});
