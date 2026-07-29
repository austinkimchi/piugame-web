import "server-only";

import { readdir } from "node:fs/promises";
import path from "node:path";
import type { Collection, Document, Filter, WithId } from "mongodb";

import { getMongoClient, hasMongoConfig } from "@/lib/mongodb";
import type { PiuCatalogVersion, PublicChart, PublicSong, SongSearchResult } from "@/lib/types";

const PAGE_SIZE = 24;
const MAX_PAGE_SIZE = 48;
const DB_NAME = process.env.SONG_CATALOG_DB ?? "piugame_sdk";
const COLLECTIONS: Record<PiuCatalogVersion, string> = {
  phoenix: process.env.PHOENIX_CATALOG_COLLECTION ?? "song_catalog",
  phoenix2: process.env.PHOENIX2_CATALOG_COLLECTION ?? "song_catalog_2",
};

interface CatalogDocument extends Document {
  songName?: string;
  songKey?: string;
  artist?: string;
  piuVersion?: string;
  catalogVersion?: string;
  images?: string[];
  previewUrl?: string | null;
  audioPreviewUrl?: string | null;
  chartsFull?: PublicChart[];
  chartTokens?: string[];
  folder?: string;
  series?: string;
  tags?: string[];
  folderPosition?: number;
}

function slugify(value: string): string {
  return value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
}

function encodeCursor(offset: number): string {
  return Buffer.from(String(offset), "utf8").toString("base64url");
}

function decodeCursor(cursor: string | null): number {
  if (!cursor) {
    return 0;
  }

  const decoded = Number.parseInt(Buffer.from(cursor, "base64url").toString("utf8"), 10);
  return Number.isFinite(decoded) && decoded >= 0 ? decoded : 0;
}

function cleanText(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function versionFromDocument(document: CatalogDocument, fallback: PiuCatalogVersion): PiuCatalogVersion {
  const raw = cleanText(document.piuVersion ?? document.catalogVersion);
  return raw === "phoenix2" ? "phoenix2" : fallback;
}

function imageUrlFor(version: PiuCatalogVersion, filename: string | null): string | null {
  if (!filename) {
    return null;
  }

  const safeFilename = path.basename(filename);
  const imageDir = version === "phoenix2" ? "song_img2" : "song_img";
  return `/assets/piu/${version}/${imageDir}/${safeFilename}`;
}

function chartSummary(document: CatalogDocument): string[] {
  if (Array.isArray(document.chartTokens) && document.chartTokens.length > 0) {
    return document.chartTokens.slice(0, 8).map(cleanText).filter(Boolean);
  }

  if (Array.isArray(document.chartsFull)) {
    return document.chartsFull
      .slice(0, 8)
      .map((chart) => cleanText(chart.token || `${chart.mode}${chart.level}`))
      .filter(Boolean);
  }

  return [];
}

function publicSongFromDocument(document: WithId<CatalogDocument>, fallbackVersion: PiuCatalogVersion): PublicSong {
  const title = cleanText(document.songName ?? document.songKey ?? "Untitled Song");
  const artist = cleanText(document.artist ?? "Unknown Artist");
  const version = versionFromDocument(document, fallbackVersion);
  const image = Array.isArray(document.images) ? cleanText(document.images[0]) : "";
  const previewUrl = cleanText(document.previewUrl ?? document.audioPreviewUrl) || null;

  return {
    slug: `${slugify(title)}-${slugify(artist) || "unknown"}-${version}`,
    title,
    artist,
    version,
    imageUrl: imageUrlFor(version, image || null),
    previewUrl,
    previewAvailable: Boolean(previewUrl),
    chartSummary: chartSummary(document),
    folder: cleanText(document.folder) || null,
    series: cleanText(document.series) || null,
    tags: Array.isArray(document.tags) ? document.tags.map(cleanText).filter(Boolean).slice(0, 12) : [],
  };
}

function projection() {
  return {
    songName: 1,
    songKey: 1,
    artist: 1,
    piuVersion: 1,
    catalogVersion: 1,
    images: { $slice: 1 },
    previewUrl: 1,
    audioPreviewUrl: 1,
    chartTokens: { $slice: 8 },
    chartsFull: { $slice: 8 },
    folder: 1,
    series: 1,
    tags: { $slice: 12 },
    folderPosition: 1,
  };
}

async function collectionFor(version: PiuCatalogVersion): Promise<Collection<CatalogDocument>> {
  const client = await getMongoClient();
  return client.db(DB_NAME).collection<CatalogDocument>(COLLECTIONS[version]);
}

async function findMongoSongs(
  version: PiuCatalogVersion,
  filter: Filter<CatalogDocument>,
  offset: number,
  limit: number,
): Promise<PublicSong[]> {
  const collection = await collectionFor(version);
  const documents = await collection
    .find(filter, { projection: projection() })
    .sort({ folderPosition: 1, songName: 1, artist: 1 })
    .skip(offset)
    .limit(limit)
    .toArray();

  return documents.map((document) => publicSongFromDocument(document, version));
}

async function fallbackSongs(version: PiuCatalogVersion, offset = 0, limit = PAGE_SIZE): Promise<PublicSong[]> {
  const dir =
    version === "phoenix2"
      ? path.join(process.cwd(), "public", "assets", "piu", "phoenix2", "song_img2")
      : path.join(process.cwd(), "public", "assets", "piu", "phoenix", "song_img");

  try {
    const filenames = (await readdir(dir))
      .filter((filename) => filename.toLowerCase().endsWith(".png"))
      .sort()
      .slice(offset, offset + limit);

    return filenames.map((filename, index) => ({
      slug: `${version}-jacket-${offset + index + 1}`,
      title: `${version === "phoenix2" ? "Phoenix 2" : "Phoenix"} Jacket ${offset + index + 1}`,
      artist: "PIUGAME catalog asset",
      version,
      imageUrl: imageUrlFor(version, filename),
      previewUrl: null,
      previewAvailable: false,
      chartSummary: [],
      folder: null,
      series: version === "phoenix2" ? "Phoenix 2" : "Phoenix",
      tags: [],
    }));
  } catch {
    return [];
  }
}

export async function getLandingSongs(): Promise<PublicSong[]> {
  if (!hasMongoConfig()) {
    const [phoenix2, phoenix] = await Promise.all([
      fallbackSongs("phoenix2", 0, 18),
      fallbackSongs("phoenix", 0, 6),
    ]);
    return [...phoenix2, ...phoenix];
  }

  const [phoenix2, phoenix] = await Promise.all([
    findMongoSongs("phoenix2", {}, 0, 18),
    findMongoSongs("phoenix", {}, 0, 6),
  ]);
  return [...phoenix2, ...phoenix];
}

export async function searchSongs(params: {
  query: string;
  version?: PiuCatalogVersion;
  cursor?: string | null;
  limit?: number;
}): Promise<SongSearchResult> {
  const query = cleanText(params.query);
  if (query.length < 2) {
    return { songs: [], nextCursor: null };
  }

  const limit = Math.min(Math.max(params.limit ?? PAGE_SIZE, 1), MAX_PAGE_SIZE);
  const offset = decodeCursor(params.cursor ?? null);
  const versions = params.version ? [params.version] : (["phoenix2", "phoenix"] as PiuCatalogVersion[]);

  if (!hasMongoConfig()) {
    const chunks = await Promise.all(versions.map((version) => fallbackSongs(version, 0, 250)));
    const all = chunks.flat().filter((song) => {
      const haystack = `${song.title} ${song.artist} ${song.version}`.toLowerCase();
      return haystack.includes(query.toLowerCase());
    });
    const page = all.slice(offset, offset + limit);
    return {
      songs: page,
      nextCursor: offset + limit < all.length ? encodeCursor(offset + limit) : null,
    };
  }

  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const filter: Filter<CatalogDocument> = {
    $or: [
      { songName: { $regex: escaped, $options: "i" } },
      { songKey: { $regex: escaped, $options: "i" } },
      { artist: { $regex: escaped, $options: "i" } },
      { folder: { $regex: escaped, $options: "i" } },
      { series: { $regex: escaped, $options: "i" } },
      { tags: { $regex: escaped, $options: "i" } },
    ],
  };

  const chunks = await Promise.all(versions.map((version) => findMongoSongs(version, filter, offset, limit + 1)));
  const merged = chunks.flat().sort((left, right) => left.title.localeCompare(right.title)).slice(0, limit + 1);

  return {
    songs: merged.slice(0, limit),
    nextCursor: merged.length > limit ? encodeCursor(offset + limit) : null,
  };
}

export async function getSongBySlug(slug: string): Promise<PublicSong | null> {
  if (!hasMongoConfig()) {
    const all = [...(await fallbackSongs("phoenix2", 0, 250)), ...(await fallbackSongs("phoenix", 0, 250))];
    return all.find((song) => song.slug === slug) ?? null;
  }

  const versions: PiuCatalogVersion[] = ["phoenix2", "phoenix"];
  for (const version of versions) {
    const collection = await collectionFor(version);
    const documents = await collection.find({}, { projection: projection() }).limit(5000).toArray();
    const match = documents
      .map((document) => publicSongFromDocument(document, version))
      .find((song) => song.slug === slug);
    if (match) {
      return match;
    }
  }

  return null;
}
