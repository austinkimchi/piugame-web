# Public catalog snapshots

`GET /api/catalog/v1/{version}` returns a complete public song catalog in one response. It needs no account or token. `HEAD` returns the same status and headers without a body.

Supported version IDs: `phoenix2`, `phoenix`, `xx`, `prime2`, `prime`, `fiesta`, `nx`, `zero-1st`. These are series IDs, not display labels or page slugs such as `phoenix-2`.

```sh
curl -i 'https://mypiu.austin.kim/api/catalog/v1/phoenix2'
curl -I 'https://mypiu.austin.kim/api/catalog/v1/xx'
curl -i 'https://mypiu.austin.kim/api/catalog/v1/phoenix2?removed=1'
```

By default, membership comes from the record's `supportedVersions`. `removed=1` selects records whose `removedFromVersions` includes the requested series. `removed=0` explicitly selects the default view. Unknown version IDs, repeated `removed` parameters, and other `removed` values return `400` with `Cache-Control: no-store`.

## Response

The response contains `schemaVersion: 1`, `selectedVersion`, `view` (`supported` or `removed`), `total`, `filterOptions`, and `songs`. There is no cursor or page limit. `total` equals `songs.length`. `filterOptions` contains `folders`, `series`, `levels`, and `charts` arrays, derived from the returned records. A historical series with no matching records returns an explicit empty catalog; songs from another series are never substituted.

Each song includes its `songKey`, source `version` and `slug`, title, artist, version membership, song/chart history, chart links, public image/audio URLs and preview availability, BPM, selected-version `chartSummary`, `chartTokensByVersion`, folder/series metadata and counts, tags, and premium status. Source `version` remains `phoenix` or `phoenix2` even when browsing historical series. An explicitly empty selected-version chart array stays empty; legacy chart fields are used only when that version's array is absent.

Top-level and nested fields are explicitly allowlisted. Raw local `audioPath` values, Mongo IDs, audio processing metadata, favorites, recommendations, recent plays, and other account data are excluded. Audio URLs may use the public `/api/audio-file` route. Existing song lookup accepts source-version slugs while retaining legacy aliases.

## Revalidation and failures

Successful responses carry a SHA-256 content `ETag` and `Cache-Control: public, max-age=0, must-revalidate`. Response bytes are deterministic and contain no generation timestamp. Revalidate using the previous response's ETag:

```sh
curl -i -H 'If-None-Match: "<etag-from-previous-response>"' \
  'https://mypiu.austin.kim/api/catalog/v1/phoenix2'
```

A matching validator returns `304` with no body. GET and HEAD accept weak validators, validator lists, and `*`. Different series and removed views have separate cache entries. Each process coalesces concurrent reads and caches snapshots for at most 30 seconds from the start of the database read. Successful admin catalog/audio database updates invalidate that process's entries; pending reads from an older generation cannot repopulate the cache or return stale data. Other processes observe changes on their next cache expiration.

On a cache miss, missing database configuration or a failed Mongo read returns `503` with `Cache-Control: no-store`, a safe error message, and no ETag. There is no limited filesystem fallback or stale-on-error response. Database-backed empty results are `200`, distinct from unavailable data.

Server components use `getPublicCatalogSnapshot(selectedVersion, { removed?: boolean })` from `src/lib/public-catalog.ts`, sharing the same read and cache as the API. It returns `Promise<PublicCatalogSnapshot>` or rejects with `PublicCatalogUnavailableError` (`code: PUBLIC_CATALOG_UNAVAILABLE`). DTO types live in the client-safe `src/lib/public-catalog-types.ts`. Cached DTOs are deeply frozen; copy them before attaching private data. The existing paginated `/api/songs/search` endpoint remains available.
