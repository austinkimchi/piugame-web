import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { GET } from "../src/app/api/audio-file/route.ts";
import { audioFileUrlForPath, saveCatalogAudioUpload } from "../src/lib/audio-preview.ts";

const originalCwd = process.cwd();
const originalRoots = process.env.AUDIO_PREVIEW_ROOTS;
let fixture: string;

before(async () => {
  fixture = await mkdtemp(path.join(tmpdir(), "mypiu-audio-test-"));
  process.chdir(fixture);
  delete process.env.AUDIO_PREVIEW_ROOTS;
  await mkdir("public/assets/piu/phoenix2/audio_previews/manual", { recursive: true });
  await writeFile("public/assets/piu/phoenix2/audio_previews/manual/%X (Percent X).wav", "0123456789");
  await writeFile("public/assets/piu/phoenix2/audio_previews/manual/%2F.wav", "literal percent");
  await writeFile("public/assets/piu/phoenix2/audio_previews/manual/empty.wav", "");
});

after(async () => {
  process.chdir(originalCwd);
  if (originalRoots === undefined) delete process.env.AUDIO_PREVIEW_ROOTS;
  else process.env.AUDIO_PREVIEW_ROOTS = originalRoots;
  await rm(fixture, { recursive: true, force: true });
});

function request(filePath: string, range?: string) {
  return GET(new Request(`http://localhost/api/audio-file?${new URLSearchParams({ path: filePath })}`, {
    headers: range === undefined ? undefined : { Range: range },
  }));
}

const percentPath = "phoenix2/audio_previews/manual/%X (Percent X).wav";

test("serves percent signs and spaces after exactly one URL decode", async () => {
  const response = await request(percentPath);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Content-Type"), "audio/wav");
  assert.equal(response.headers.get("Content-Length"), "10");
  assert.equal(await response.text(), "0123456789");
  const encodedLookingName = await request("phoenix2/audio_previews/manual/%2F.wav");
  assert.equal(encodedLookingName.status, 200);
  assert.equal(await encodedLookingName.text(), "literal percent");
  assert.equal((await request("%E0%A4%A.wav")).status, 404);
});

test("serves closed, open, suffix, and oversized satisfiable byte ranges", async () => {
  for (const [range, body, contentRange] of [
    ["bytes=2-5", "2345", "bytes 2-5/10"],
    ["bytes=7-", "789", "bytes 7-9/10"],
    ["bytes=-3", "789", "bytes 7-9/10"],
    ["bytes=5-999", "56789", "bytes 5-9/10"],
    ["bytes=-999", "0123456789", "bytes 0-9/10"],
  ]) {
    const response = await request(percentPath, range);
    assert.equal(response.status, 206, range);
    assert.equal(response.headers.get("Content-Range"), contentRange, range);
    assert.equal(Number(response.headers.get("Content-Length")), body.length, range);
    assert.equal(await response.text(), body, range);
  }
});

test("rejects malformed and unsatisfiable ranges without streaming invalid offsets", async () => {
  for (const range of ["bytes=-", "bytes=-0", "bytes=10-", "bytes=7-2", "bytes=0-1,4-5", ""]) {
    const response = await request(percentPath, range);
    assert.equal(response.status, 416, range);
    assert.equal(response.headers.get("Content-Range"), "bytes */10", range);
    assert.equal(await response.text(), "");
  }
  const empty = await request("phoenix2/audio_previews/manual/empty.wav");
  assert.equal(empty.status, 200);
  assert.equal(empty.headers.get("Content-Length"), "0");
  assert.equal(await empty.text(), "");
  assert.equal((await request("phoenix2/audio_previews/manual/empty.wav", "bytes=0-")).status, 416);
});

test("refuses traversal, unsupported files, and symlinks outside allowed roots", async () => {
  await writeFile("outside.wav", "private fixture");
  await symlink(path.join(fixture, "outside.wav"), "public/assets/piu/phoenix2/audio_previews/manual/escape.wav");
  for (const filePath of [
    "../../outside.wav", "..\\..\\outside.wav", "../public/../outside.wav",
    "phoenix2/audio_previews/manual/escape.wav", "secret.txt", "invalid\0.wav",
  ]) assert.equal((await request(filePath)).status, 404, filePath);

  const encodedTraversal = await GET(new Request("http://localhost/api/audio-file?path=%2e%2e%2f%2e%2e%2foutside.wav"));
  assert.equal(encodedTraversal.status, 404);
  assert.equal((await request("%2e%2e/%2e%2e/outside.wav")).status, 404);
});

test("keeps legacy static URLs and uses version-specific URLs for manual previews", () => {
  assert.equal(audioFileUrlForPath("data/audio_previews/clip.mp3", "phoenix2"), "/assets/piu/phoenix2/audio_previews/clip.mp3");
  assert.equal(audioFileUrlForPath("public/assets/piu/phoenix/audio_previews/old song.wav", "phoenix2"), "/assets/piu/phoenix/audio_previews/old%20song.wav");
  assert.equal(audioFileUrlForPath("manual/%X (Percent X).wav", "phoenix2"), `/api/audio-file?path=${encodeURIComponent(percentPath)}`);
  const oldVersion = audioFileUrlForPath("public/assets/piu/phoenix/audio_previews/manual/same.wav", "phoenix2");
  assert.equal(new URL(oldVersion!, "http://localhost").searchParams.get("path"), "phoenix/audio_previews/manual/same.wav");
  assert.equal(audioFileUrlForPath("manual/../escape.wav", "phoenix2"), null);
  assert.equal(audioFileUrlForPath("manual/invalid\0.wav", "phoenix2"), null);
});

test("retains configured audio roots and legacy public path inputs", async () => {
  const customRoot = path.join(fixture, "external-exports");
  await mkdir(customRoot);
  await writeFile(path.join(customRoot, "custom clip.mp3"), "external clip");
  process.env.AUDIO_PREVIEW_ROOTS = customRoot;
  try {
    assert.equal(await (await request("custom clip.mp3")).text(), "external clip");
    assert.equal(await (await request(`public/assets/piu/${percentPath}`)).text(), "0123456789");
  } finally {
    delete process.env.AUDIO_PREVIEW_ROOTS;
  }
});

test("fresh uploads resolve immediately, preserve exact bytes, and retain earlier exports", async () => {
  const first = await saveCatalogAudioUpload("phoenix2", "New % song", "Artist", new File(["original export"], "clip.wav", { type: "audio/wav" }));
  const response = await GET(new Request(new URL(first.publicUrl, "http://localhost")));
  assert.equal(response.status, 200);
  assert.equal(await response.text(), "original export");
  assert.equal(response.headers.get("Cache-Control"), "public, max-age=0, must-revalidate");

  const corrected = await saveCatalogAudioUpload("phoenix2", "New % song", "Artist", new File(["corrected export"], "clip.wav", { type: "audio/wav" }));
  assert.notEqual(corrected.publicUrl, first.publicUrl);
  assert.equal(await (await GET(new Request(new URL(corrected.publicUrl, "http://localhost")))).text(), "corrected export");
  assert.equal(await readFile(path.join("public/assets/piu/phoenix2/audio_previews", first.audioPath), "utf8"), "original export");
  assert.equal(await (await GET(new Request(new URL(first.publicUrl, "http://localhost")))).text(), "original export");
});

test("keeps upload URLs distinct between catalog versions", async () => {
  for (const version of ["phoenix", "phoenix2"] as const) {
    const upload = await saveCatalogAudioUpload(version, "same", "artist", new File([version], "clip.wav"));
    assert.equal(await (await GET(new Request(new URL(upload.publicUrl, "http://localhost")))).text(), version);
  }
});
