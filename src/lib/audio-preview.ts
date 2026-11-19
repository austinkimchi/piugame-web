import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import type { PiuCatalogVersion } from "./types.ts";

const AUDIO_UPLOAD_MAX_BYTES = 16 * 1024 * 1024;
const AUDIO_UPLOAD_CONTENT_TYPES = new Map([
  ["audio/mpeg", ".mp3"],
  ["audio/mp3", ".mp3"],
  ["audio/ogg", ".ogg"],
  ["audio/wav", ".wav"],
  ["audio/x-wav", ".wav"],
  ["audio/mp4", ".m4a"],
  ["audio/x-m4a", ".m4a"],
]);

export function audioFileUrlForPath(localPath: string | null | undefined, version: PiuCatalogVersion): string | null {
  const normalized = String(localPath ?? "").trim().replaceAll("\\", "/").replace(/^\/+/, "");
  if (!normalized || normalized.includes("\0")) return null;

  let publicPath: string;
  if (normalized.startsWith("data/audio_previews/")) {
    publicPath = `assets/piu/${version}/audio_previews/${normalized.slice("data/audio_previews/".length)}`;
  } else if (normalized.startsWith("public/")) {
    publicPath = normalized.slice("public/".length);
  } else if (normalized.startsWith("assets/")) {
    publicPath = normalized;
  } else if (normalized.startsWith("manual/")) {
    publicPath = `assets/piu/${version}/audio_previews/${normalized}`;
  } else {
    return null;
  }

  const segments = publicPath.split("/").filter(Boolean);
  if (segments.some((segment) => segment === "." || segment === "..")) return null;
  publicPath = segments.join("/");

  // Next's production public-file index is built at server startup. Manual
  // uploads must be served dynamically to work without restarting the site.
  if (/^assets\/piu\/(phoenix|phoenix2)\/audio_previews\/manual\//.test(publicPath)) {
    return `/api/audio-file?path=${encodeURIComponent(publicPath.slice("assets/piu/".length))}`;
  }
  return `/${segments.map(encodeURIComponent).join("/")}`;
}

function audioUploadExtension(file: File): string {
  const extension = path.extname(file.name).toLowerCase();
  if (Array.from(AUDIO_UPLOAD_CONTENT_TYPES.values()).includes(extension)) return extension;
  const contentTypeExtension = AUDIO_UPLOAD_CONTENT_TYPES.get(file.type.toLowerCase());
  if (contentTypeExtension) return contentTypeExtension;
  throw new Error("Audio upload must be an MP3, OGG, WAV, or M4A file.");
}

function filenamePart(value: string): string {
  return value.normalize("NFKD").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 100);
}

export async function saveCatalogAudioUpload(version: PiuCatalogVersion, title: string, artist: string, file: File): Promise<{ audioPath: string; publicUrl: string }> {
  if (file.size < 1) throw new Error("Audio upload is empty.");
  if (file.size > AUDIO_UPLOAD_MAX_BYTES) throw new Error("Audio upload must be 16 MB or smaller.");

  const extension = audioUploadExtension(file);
  const bytes = Buffer.from(await file.arrayBuffer());
  // Corrected exports get a new URL, and never overwrite the prior clip.
  const digest = createHash("sha256").update(bytes).digest("hex").slice(0, 16);
  const filename = `${filenamePart(title) || "untitled"}-${filenamePart(artist) || "unknown"}-${digest}${extension}`;
  const uploadDir = path.join(process.cwd(), "public", "assets", "piu", version, "audio_previews", "manual");
  await mkdir(uploadDir, { recursive: true });
  await writeFile(path.join(uploadDir, filename), bytes);

  const audioPath = `manual/${filename}`;
  return { audioPath, publicUrl: audioFileUrlForPath(audioPath, version)! };
}
