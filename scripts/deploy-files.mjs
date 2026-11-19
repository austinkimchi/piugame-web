import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { cp, lstat, mkdir, open, readdir, readFile, readlink, realpath, rename, rm, statfs } from "node:fs/promises";
import path from "node:path";

export const MANUAL_PATHS = ["phoenix", "phoenix2"].map((version) => `public/assets/piu/${version}/audio_previews/manual`);
export const ARTIFACT_PATHS = [".next", "node_modules"];
export const inside = (root, entry) => entry === root || entry.startsWith(`${root}${path.sep}`);
export async function exists(file) {
  try { await lstat(file); return true; } catch (error) { if (error.code === "ENOENT") return false; throw error; }
}

// Resolve every existing ancestor independently: realpath alone would silently
// bless a symlink to a different app, state directory, or mutable-media root.
export async function plainPath(file, { missing = false, directory = false } = {}) {
  if (!path.isAbsolute(file) || path.normalize(file) !== file) throw new Error(`Noncanonical path: ${file}`);
  const parts = file.split(path.sep).filter(Boolean);
  let current = path.parse(file).root;
  for (let i = 0; i < parts.length; i++) {
    current = path.join(current, parts[i]);
    let info;
    try { info = await lstat(current); } catch (error) {
      if (missing && error.code === "ENOENT") return;
      throw error;
    }
    if (info.isSymbolicLink() || (i < parts.length - 1 && !info.isDirectory())) throw new Error(`Unexpected path boundary: ${current}`);
    if (i === parts.length - 1 && directory && !info.isDirectory()) throw new Error(`Expected directory: ${current}`);
  }
}

export async function digest(file, deadline = Infinity) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) {
    if (Date.now() > deadline) throw new Error("Filesystem operation timed out");
    hash.update(chunk);
  }
  return hash.digest("hex");
}

// Runtime links may be relative and internal to the whole runtime root, so
// .next -> ../node_modules works after relocation. Absolute or escaping links
// are refused even when their staging target happens to exist during health.
export async function inventory(root, names, { links = false, sync = false, hash = true, deadline = Infinity } = {}) {
  const entries = [];
  const visit = async (relative) => {
    if (Date.now() > deadline) throw new Error("Filesystem operation timed out");
    const file = path.join(root, relative);
    const info = await lstat(file);
    const item = { path: relative, mode: info.mode & 0o777, type: "directory" };
    if (info.isSymbolicLink()) {
      const target = await readlink(file);
      const lexical = path.resolve(path.dirname(file), target);
      const internal = (resolved) => ARTIFACT_PATHS.some((name) => inside(path.join(root, name), resolved));
      if (!links || path.isAbsolute(target) || !internal(lexical) || !internal(await realpath(file))) {
        throw new Error(`Unsafe runtime/media symlink: ${relative}`);
      }
      Object.assign(item, { type: "link", target });
    } else if (info.isDirectory()) {
      for (const child of (await readdir(file)).sort()) await visit(path.join(relative, child));
    } else if (info.isFile()) {
      Object.assign(item, { type: "file", size: info.size, ...(hash ? { sha256: await digest(file, deadline) } : {}) });
      if (sync) { const handle = await open(file, "r"); try { await handle.sync(); } finally { await handle.close(); } }
    } else throw new Error(`Unsupported filesystem entry: ${relative}`);
    if (sync && info.isDirectory()) await syncDirectory(file);
    entries.push(item);
  };
  for (const name of names) {
    if (await exists(path.join(root, name))) await visit(name);
    else entries.push({ path: name, type: "missing" });
  }
  return entries.sort((a, b) => a.path.localeCompare(b.path, "en"));
}

export async function verifyInventory(root, names, expected, options) {
  const actual = await inventory(root, names, options);
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error("Snapshot/artifact integrity mismatch");
}

export async function syncDirectory(directory) {
  const handle = await open(directory, "r");
  try { await handle.sync(); } finally { await handle.close(); }
}

export async function atomicWrite(file, value) {
  const temporary = `${file}.tmp`;
  if (await exists(temporary)) {
    const info = await lstat(temporary);
    if (!info.isFile() || info.isSymbolicLink()) throw new Error("Unexpected atomic-write temporary path");
    await rm(temporary);
  }
  const handle = await open(temporary, "wx", 0o600);
  try { await handle.writeFile(value); await handle.sync(); } finally { await handle.close(); }
  await rename(temporary, file);
  await syncDirectory(path.dirname(file));
}
export const writeJson = (file, value) => atomicWrite(file, `${JSON.stringify(value)}\n`);
export async function readJson(file) {
  await plainPath(file);
  const info = await lstat(file);
  if (!info.isFile() || info.size > 16 * 1024 * 1024) throw new Error("Invalid deployment state file");
  return JSON.parse(await readFile(file, "utf8"));
}

export async function copyTrees(from, to, names, options = {}) {
  await mkdir(to, { recursive: true, mode: 0o700 });
  for (const name of names) {
    if (Date.now() > (options.deadline ?? Infinity)) throw new Error("Filesystem copy timed out");
    if (await exists(path.join(from, name))) {
      await mkdir(path.dirname(path.join(to, name)), { recursive: true });
      if (options.copy) await options.copy(path.join(from, name), path.join(to, name));
      else await cp(path.join(from, name), path.join(to, name), { recursive: true, preserveTimestamps: true, verbatimSymlinks: true });
    }
  }
  const entries = await inventory(to, names, { ...options, sync: true });
  // inventory syncs each named tree, but manual roots have several newly
  // created prefix directories. Persist every link up to the destination too.
  const prefixes = new Set([to]);
  for (const name of names) {
    let directory = path.dirname(path.join(to, name));
    while (inside(to, directory)) {
      if (await exists(directory)) prefixes.add(directory);
      if (directory === to) break;
      directory = path.dirname(directory);
    }
  }
  for (const directory of [...prefixes].sort((a, b) => b.length - a.length)) await syncDirectory(directory);
  return entries;
}

export async function treeBytes(root) {
  let total = 0;
  if (!await exists(root)) return total;
  const walk = async (file) => {
    let info;
    try { info = await lstat(file); } catch (error) { if (["ENOENT", "ENOTDIR"].includes(error.code)) return; throw error; }
    if (info.isDirectory()) {
      let children;
      try { children = await readdir(file); } catch (error) { if (["ENOENT", "ENOTDIR"].includes(error.code)) return; throw error; }
      for (const name of children) await walk(path.join(file, name));
    }
    else total += info.size;
  };
  await walk(root);
  return total;
}

export async function spaceGuard(root, maxBytes, reserveBytes, { initial = false } = {}) {
  const bytes = await treeBytes(root);
  const fs = await statfs(root);
  if (bytes > maxBytes || fs.bavail * fs.bsize < reserveBytes + (initial ? maxBytes - bytes : 0)) {
    throw new Error("Deployment storage allowance or free-space reserve exceeded");
  }
  return bytes;
}
