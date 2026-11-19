import { isPiuSeriesId } from "./catalog-version.ts";
import type { PublicCatalogResponse } from "./public-catalog-cache.ts";
import type { PublicCatalogOptions } from "./public-catalog-types.ts";
import type { PiuSeriesId } from "./types.ts";

export const PUBLIC_CATALOG_CACHE_CONTROL = "public, max-age=0, must-revalidate";
// This policy belongs only to the anonymous public snapshot route. Do not apply
// it to private account overlays or other APIs through global configuration.
const PUBLIC_CATALOG_CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
  "Access-Control-Allow-Headers": "If-None-Match",
  "Access-Control-Expose-Headers": "ETag, Cache-Control",
};
type Loader = (version: PiuSeriesId, options?: PublicCatalogOptions) => Promise<PublicCatalogResponse>;

export function publicCatalogOptionsResponse(): Response {
  // Preflight never requires a catalog read, account, or version lookup.
  return new Response(null, {
    status: 204,
    headers: { ...PUBLIC_CATALOG_CORS_HEADERS, Allow: "GET, HEAD, OPTIONS", "Cache-Control": "no-store" },
  });
}

function errorResponse(request: Request, status: number, error: string): Response {
  return new Response(request.method === "HEAD" ? null : JSON.stringify({ error }), {
    status, headers: { ...PUBLIC_CATALOG_CORS_HEADERS, "Cache-Control": "no-store", "Content-Type": "application/json; charset=utf-8" },
  });
}

export async function publicCatalogHttpResponse(request: Request, version: string, load: Loader): Promise<Response> {
  const query = new URL(request.url).searchParams;
  const removedValues = query.getAll("removed");
  if (!isPiuSeriesId(version) || removedValues.length > 1 ||
    (removedValues.length === 1 && removedValues[0] !== "0" && removedValues[0] !== "1")) {
    return errorResponse(request, 400, "Unsupported catalog version or removed view.");
  }
  try {
    const { body, etag } = await load(version, { removed: removedValues[0] === "1" });
    const headers = { ...PUBLIC_CATALOG_CORS_HEADERS, "Cache-Control": PUBLIC_CATALOG_CACHE_CONTROL, "Content-Type": "application/json; charset=utf-8", ETag: etag };
    // GET and HEAD use weak comparison for If-None-Match, including lists and *.
    const matches = request.headers.get("If-None-Match")?.split(",").some((candidate) => {
      const value = candidate.trim();
      return value === "*" || value.replace(/^W\//, "") === etag;
    });
    if (matches) return new Response(null, { status: 304, headers });
    return new Response(request.method === "HEAD" ? null : body, { status: 200, headers });
  } catch {
    return errorResponse(request, 503, "The public catalog is temporarily unavailable.");
  }
}
