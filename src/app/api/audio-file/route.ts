import { createReadStream } from "node:fs";
import { realpath, stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const AUDIO_EXTENSIONS = new Map([
  [".mp3", "audio/mpeg"],
  [".ogg", "audio/ogg"],
  [".oga", "audio/ogg"],
  [".wav", "audio/wav"],
  [".m4a", "audio/mp4"],
]);

// Legacy filenames can be replaced by an administrator. Do not pin their bytes
// in browsers or CDNs for a year after a corrected export is uploaded.
const CACHE_CONTROL = "public, max-age=0, must-revalidate";

function allowedRoots(): string[] {
  const configuredRoots = String(process.env.AUDIO_PREVIEW_ROOTS ?? "")
    .split(path.delimiter)
    .map((root) => root.trim())
    .filter(Boolean);

  return [
    ...configuredRoots,
    path.join(process.cwd(), "data", "audio_previews"),
    path.join(process.cwd(), "public", "assets", "piu"),
    path.join(process.cwd(), "public", "assets", "piu", "phoenix", "audio_previews"),
    path.join(process.cwd(), "public", "assets", "piu", "phoenix2", "audio_previews"),
  ].map((root) => path.resolve(root));
}

function audioPathCandidates(input: string): { root: string; candidate: string }[] {
  // URLSearchParams already decoded this value. A second decode breaks literal
  // percent signs in song names and can turn filenames into path separators.
  const relativePath = input.replaceAll("\\", "/")
    .replace(/^\/+/, "")
    .replace(/^data\/audio_preview\//, "")
    .replace(/^data\/audio_previews\//, "")
    .replace(/^public\/assets\/piu\//, "");
  const extension = path.extname(relativePath).toLowerCase();

  if (!AUDIO_EXTENSIONS.has(extension) || relativePath.includes("\0")) {
    return [];
  }

  return allowedRoots()
    .map((root) => ({ root, candidate: path.resolve(root, relativePath) }))
    .filter(({ root, candidate }) => candidate.startsWith(`${root}${path.sep}`));
}

function contentRange(range: string | null, size: number): { start: number; end: number } | null {
  if (range === null) {
    return { start: 0, end: size - 1 };
  }

  if (size === 0) return null;

  const match = range.match(/^bytes=(\d*)-(\d*)$/);
  if (!match) {
    return null;
  }

  const rawStart = match[1] ?? "";
  const rawEnd = match[2] ?? "";
  if (!rawStart && !rawEnd) return null;
  const suffixLength = rawStart ? null : Number.parseInt(rawEnd, 10);
  if (suffixLength === 0) return null;
  const suffixStart = suffixLength === null ? 0 : Math.max(size - suffixLength, 0);
  const start = rawStart ? Number.parseInt(rawStart, 10) : suffixStart;
  const end = rawEnd && rawStart ? Math.min(Number.parseInt(rawEnd, 10), size - 1) : size - 1;

  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end >= size || start > end) {
    return null;
  }

  return { start, end };
}

export async function GET(request: Request) {
  const requestPath = new URL(request.url).searchParams.get("path");
  if (!requestPath) {
    return Response.json({ error: "Missing audio path." }, { status: 400 });
  }

  const candidatePaths = audioPathCandidates(requestPath);
  if (candidatePaths.length === 0) {
    return Response.json({ error: "Audio file not found." }, { status: 404 });
  }

  for (const { root, candidate } of candidatePaths) {
    try {
      const [realRoot, filePath] = await Promise.all([realpath(root), realpath(candidate)]);
      if (!filePath.startsWith(`${realRoot}${path.sep}`)) continue;
      const file = await stat(filePath);
      if (!file.isFile()) {
        continue;
      }

      const range = contentRange(request.headers.get("range"), file.size);
      if (!range) {
        return new Response(null, {
          status: 416,
          headers: {
            "Accept-Ranges": "bytes",
            "Content-Range": `bytes */${file.size}`,
          },
        });
      }

      const contentLength = range.end - range.start + 1;
      const headers = new Headers({
        "Accept-Ranges": "bytes",
        "Cache-Control": CACHE_CONTROL,
        "Content-Length": String(contentLength),
        "Content-Type": AUDIO_EXTENSIONS.get(path.extname(filePath).toLowerCase()) ?? "application/octet-stream",
      });

      if (request.headers.has("range")) {
        headers.set("Content-Range", `bytes ${range.start}-${range.end}/${file.size}`);
      }

      const body = file.size === 0 ? null : Readable.toWeb(createReadStream(filePath, { start: range.start, end: range.end })) as ReadableStream;
      return new Response(body, {
        status: request.headers.has("range") ? 206 : 200,
        headers,
      });
    } catch {
      continue;
    }
  }

  return Response.json({ error: "Audio file not found." }, { status: 404 });
}
