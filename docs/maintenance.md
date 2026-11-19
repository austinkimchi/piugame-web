# MyPIU maintenance runbook

Last verified: **November 19, 2026**, against production commit `146d4ce`, repository source, official release notices, and the live site. Counts below are the audit baseline before the October catalog reconciliation, not permanent expected totals. Recheck deployment and database state before changing production.

## Production and data ownership

| Component | Verified baseline |
| --- | --- |
| Public website | `https://mypiu.austin.kim` |
| Origin | `slim7prox`, checkout `/home/pkimchi/piugame-web-prod`, port `4090` |
| Web service | systemd user unit `piugame-web.service` |
| Deployment | `piugame-web-deploy.timer` checks GitHub `main` every minute; deployment resets the checkout to `main`, installs dependencies, builds, and restarts the service |
| Catalog database | `SONG_CATALOG_DB=piugame_sdk`, unified `CATALOG_COLLECTION=catalog` |
| Catalog baseline | 676 total documents; 654 support Phoenix 2 |
| Source collections | `song_catalog`: 639 documents; `song_catalog_2`: 654 documents; manual overrides are maintained separately |
| Community database | `COMMUNITY_DB_NAME=piugame_web`: accounts, sessions, favorites, community content, performance, and mobile authentication/import records |

The deployment audit did **not** establish an automatic health check or rollback. A successful build or running process alone is insufficient evidence that a release works. Cloudflare configuration, Workers, and routing must be inspected separately before changing them; the existence of Workers in the account does not mean this Next.js origin runs in a Worker.

Use a branch or isolated worktree. The development and production checkouts are distinct, and development may contain unique uncommitted maintenance scripts. Preserve them. The Mac mobile checkout also has pre-existing Xcode signing/project edits; use an isolated mobile worktree for new work.

## Architecture and code map

MyPIU uses the Next.js App Router, React, and the MongoDB Node driver. PIUGAME parsing comes from the [PIUGAME SDK](https://github.com/austinkimchi/piugame-sdk); native clients and extensions live in [piugame-mobile](https://github.com/austinkimchi/piugame-mobile). Use the current `package-lock.json` and installed package versions for build decisions: the initial November 19 production audit recorded Next.js 16.2.12, React 19.2.4, and SDK 1.3.3, while later dependency installation resolved Next.js 16.3.0.

| Area | Owning code |
| --- | --- |
| Catalog, versions, history, media references | [`catalog.ts`](../src/lib/catalog.ts), [`catalog-version.ts`](../src/lib/catalog-version.ts), [`types.ts`](../src/lib/types.ts) |
| Search and song pages | [`api/songs/search/route.ts`](../src/app/api/songs/search/route.ts), [`songs/[slug]/page.tsx`](../src/app/songs/%5Bslug%5D/page.tsx) |
| Accounts, favorites, community | [`auth.ts`](../src/lib/auth.ts), [`chart-community.ts`](../src/lib/chart-community.ts) |
| Performance and summaries | [`performance.ts`](../src/lib/performance.ts) and adjacent `performance-*` modules |
| Native and extension integration | [Mobile API](mobile-api.md), [`mobile-auth.ts`](../src/lib/mobile-auth.ts), [`mobile-sync.ts`](../src/lib/mobile-sync.ts) |

Local development listens on port **4080**; `npm run build` followed by `npm start` serves port **4090**. Read `AGENTS.md` and the installed `node_modules/next/dist/docs/` before changing framework code. Configure `MONGODB_URI`, `SONG_CATALOG_DB`, `CATALOG_COLLECTION`, and `COMMUNITY_DB_NAME` for a disposable development database. Bundled jackets provide only a limited fallback when MongoDB is not configured.

## How catalog data reaches the page

[`src/lib/catalog.ts`](../src/lib/catalog.ts) reads the unified collection, filters on `supportedVersions` or `removedFromVersions`, and selects version-specific chart tokens from `chartTokensByVersion`. [`catalog-merge.ts`](../src/lib/catalog-merge.ts) matches source songs using normalized `songKey`/song name plus artist. Refreshing a source collection alone does not establish that the public catalog was updated.

Preserve Mongo `_id`, song identity, manually curated metadata, audio references, tags, and existing history. Public slugs are derived from title, artist, and catalog version; changing these fields can break links and favorites. Chart links and history connect chart identities across versions. Update the affected version's charts without overwriting Phoenix charts when maintaining Phoenix 2. Keep historical removals and manual overrides intact.

Premium status is currently derived from [`premium-songs.ts`](../src/lib/premium-songs.ts), so a new premium song requires a code update as well as catalog data. R!SE Steam Link availability is a different restriction from Premium Mode.

## Verify a game release

Use ANDAMIRO's official notices and chart listings for release dates, metadata, chart levels, restrictions, and modifications. Record the source URL and verification date. Distinguish a teaser, event prerelease, and generally available release. Do not infer unknown chart levels from a trailer.

The [October 15 notice](https://piugame.com/phoenix2_notice?&wr_id=357) covers Phoenix 2 v1.02.0/v1.02.1:

- Six new songs: NEMONEMO, Mephitz, Falling Stars, Until Defined, PHYSALIS, and Assault TAXI.
- Arcade charts for 15 existing R!SE Vol.1 songs, restricted to Steam Link accounts.
- A modification to Hello William D20.

PHYSALIS is Premium Mode exclusive. Verify the 15 R!SE songs' exact chart lists against official chart pages; the notice names these songs without their full difficulty lists. Preserve pre-existing R!SE charts when adding arcade charts.

The [official v1.03 teaser](https://www.youtube.com/watch?v=Jja7HusBVzc) announces November 24, 2026, with an earlier IAAPA preview. As of this runbook's verification date, that content must not be represented as generally released. Recheck the official release notice on or after release rather than promoting a draft automatically.

## Back up, plan, apply, verify

1. Record the production commit, service status, catalog counts, relevant source versions, and working-tree changes. Confirm which process owns the update; avoid concurrent catalog writers.
2. Create a dated backup of affected collections, including manual overrides, and any media to be replaced. Preserve BSON types and identifiers. Record its location and verify it can be read; test restoration in an isolated database before relying on it. Keep backups and credentials outside Git.
3. Build a dry-run plan from verified release data. Review each insertion and changed field, chart tokens, release history, restrictions, media paths, and preserved manual fields. Reject unexpected deletions, identity changes, unrelated version changes, and future releases.
4. Test on a disposable copy. Confirm incomplete source data is rejected, applying the same release again produces no further changes, and concurrent changes cause a conflict rather than being overwritten. Review the concrete production diff before applying it.
5. Apply with the reviewed tool and compare actual writes with the plan. Re-run the dry run to establish idempotence. Check version-specific counts, provenance, media availability, and unchanged identities, manual audio, and older-version charts.
6. Verify the public API and browser: search each added song; open its details; check artist, BPM, folder, charts, history, premium/restriction information, and jacket. Compare representative Phoenix songs and favorites with the baseline. Check anonymous and authorized signed-in behavior.

The exact import command depends on the reviewed tooling in the checkout. Historically, `.gitignore` excluded `scripts`, while `package.json` advertised import/migration commands. Do not recover and execute an old script without reviewing its source and dry-run behavior. Record the command and revision actually used in the release record.

## Audio and jackets

Bundled files live under `public/assets/piu/{phoenix,phoenix2}/`. Media resolution is in [`catalog.ts`](../src/lib/catalog.ts); filesystem streaming is in [`api/audio-file/route.ts`](../src/app/api/audio-file/route.ts). Admin editing uses [`PATCH /api/songs/[slug]/catalog`](../src/app/api/songs/%5Bslug%5D/catalog/route.ts), requires an admin account, and accepts MP3, OGG, WAV, or M4A audio up to 16 MiB. Existing manual previews use the catalog's `audio_previews/manual/` directory.

Austin uses Ableton to match the precise in-game preview start heard in YouTube footage, cut the clip, normalize, and export it. Inspected manual WAV examples are 10 seconds, stereo, 48 kHz, 24-bit PCM. Sample peaks vary: several are near 0 dBFS, while others are lower. These observations do not justify renormalizing the existing library or substituting loudness normalization for peak normalization.

For a new clip, retain the source URL, confirmed start/end timestamps, export settings, and review result. FFmpeg may reproduce an established cut and normalization setting. Do not select an arbitrary chorus or treat trailer timestamps as confirmed in-game boundaries. If timing or source confidence is insufficient, leave the clip absent for Austin to finish manually.

Inspect format, duration, channels, sample rate, peak/clipping, and audible cut boundaries; compare with curated exports. Preserve the old file when replacing a clip. Verify the exact catalog URL, including spaces or punctuation, returns the intended bytes and content type. Check range requests used for seeking, and check after a service restart and deployment. `previewAvailable=true` describes a catalog reference; it does not prove the file exists or plays.

**Manual completion needed — `%X (Percent X)` by Pory (November 19, 2026):** the catalog references `data\audio_previews\manual\%X (Percent X) - Pory.wav`, but that exact export was not found in the inspected PIU projects, Ableton folders, or production audio roots, and its public preview URL returned 404. Restore the verified original to `public/assets/piu/phoenix2/audio_previews/manual/%X (Percent X) - Pory.wav`, or upload a verified export through the admin editor. The existing `xpercentxpory.mp3` is a 12.04-second, 44.1 kHz stereo file; its intended cut and normalization have not been established, so do not substitute it. If re-exporting is necessary, confirm and record the source and exact boundaries first. Preserve the curated catalog reference until the correct clip is available.

Preview players remember a confirmed 404 only in page-session memory and show “Preview unavailable.” Confirmation happens after an actual media-load failure, with one shared in-flight range request per URL; normal songs receive no extra check. Reloading retries the original URL, and a new upload URL is checked independently. Autoplay denial, cancellation, offline errors and other HTTP statuses do not mark a preview missing.

Jacket syncing is a separate filesystem operation. Review source/destination paths before copying; do not assume every worktree has a sibling SDK checkout. Verify all newly advertised image URLs after deployment.

## Performance and mobile clients

[`performance.ts`](../src/lib/performance.ts) stores profiles, deduplicated play events, chart summaries, and metric snapshots in the community database, scoped to user and game version. The home page's “Recently played” count is the latest session's size; the recent-song feed can contain a larger historical total. An unavailable clear count should remain unknown rather than becoming zero.

Web server sync, native uploads, and extension imports have different authorization paths. Production scheduled sync is `POST /api/performance/sync-due`, authenticated with `PERFORMANCE_SYNC_SECRET`; do not invoke it merely to test a read path. Native clients use the [mobile API](mobile-api.md) and PKCE or Apple token exchange. Imports accept normalized data, not PIUGAME passwords, cookies, or raw HTML. See [Apple setup](sign-in-with-apple.md) for provider configuration. The older [performance plan](performance-feature-plan.md) describes design intentions; verify code and deployment before treating a proposed scheduler as installed.

Use the owner's authorized account for necessary signed-in smoke tests without placing tokens or private account data in fixtures, logs, or docs. Catalog/search changes can affect the web UI and native clients; validate their shared contract.

## Deploy and recover

Run relevant tests, the TypeScript check, and a build on the candidate revision before merging. The `main` watcher makes merging a production action. Retain the prior commit, recoverable database backup, and media backup, then verify the timer deployed the expected commit.

Read-only origin checks include:

```sh
git -C /home/pkimchi/piugame-web-prod rev-parse HEAD
systemctl --user status piugame-web.service --no-pager
systemctl --user status piugame-web-deploy.timer --no-pager
```

Check origin and public behavior, including search, a song detail, a jacket, an audio URL, and an authorized signed-in flow. A protected public request returning a challenge or 403 is not evidence of an application regression; verify through the authorized browser and inspect the origin before changing edge rules.

For recovery, first coordinate the deployment watcher so it cannot replace a restored revision. Git rollback does not restore database writes or overwritten media. Restore only affected data/files from the verified backup, preserve later legitimate changes, and repeat application checks. Do not claim recovery is tested until the isolated restore and intended rollback path actually pass.
