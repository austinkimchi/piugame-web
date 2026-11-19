# MyPIU maintenance runbook

Last verified: **November 19, 2026**, with production running commit `bd3c718` on Node 24.22.3 and the separately installed recovery driver from reviewed head `baf9b563`. The October catalog release was applied using commit `844e43d`; the initial audit used `146d4ce`. Counts below describe the completed catalog update, not permanent expected totals. Recheck deployment and database state before changing production. The [maintenance task ledger](maintenance-plan.md) tracks every original request, completed work and remaining gaps.

## Production and data ownership

| Component | Verified state |
| --- | --- |
| Public website | `https://mypiu.austin.kim` |
| Origin | `slim7prox`, checkout `/home/pkimchi/piugame-web-prod`, port `4090` |
| Web service | systemd user unit `piugame-web.service` |
| Runtime | Node 24.22.3 in the web service and deploy script; the default shell remains on Node 23.11.0 |
| Deployment | `piugame-web-deploy.timer` checks GitHub `main` every minute; the installed immutable recovery driver stages install/build, preserves runtime/manual media, switches the stopped service and checks readiness |
| Catalog database | `SONG_CATALOG_DB=piugame_sdk`, unified `CATALOG_COLLECTION=catalog` |
| Catalog after October update | 697 total documents; 675 support Phoenix 2 |
| Source collections | `song_catalog`: 639 documents; `song_catalog_2`: 675 documents |
| Manual overrides | `song_catalog_2_media_overrides`: 404; `song_catalog_series_overrides`: 444; unchanged by the catalog update |
| Community database | `COMMUNITY_DB_NAME=piugame_web`: accounts, sessions, favorites, community content, performance, and mobile authentication/import records |

The installed driver now checks origin HTML, built static bytes and catalog readiness, and provides durable recovery for its documented phases. All 53 isolated Linux deployment tests passed and a normal full promotion was verified; a real live post-promotion rollback was not deliberately exercised. The single-instance snapshot/switch interrupted origin service for about 92 seconds. A successful build or running process alone is insufficient evidence that a release works. Cloudflare configuration, Workers, and routing still need an authenticated account audit; the existence of Workers in the account does not mean this Next.js origin runs in a Worker.

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

### Completed October catalog update

On November 19, commit `844e43d` applied **43 operations**: 21 new songs in each of `catalog` and `song_catalog_2`, plus the Hello William D20 history event. Public verification at **16:57:07 UTC** found 675 Phoenix 2 songs, including all 21 additions and their 171 charts. Fresh exports produced a zero-change plan. Existing BSON documents were unchanged except for the reviewed Hello William history append; all 63 manual-audio hashes matched. Audio for the 21 additions remains absent until verified.

The private release record is under `/home/pkimchi/Documents/piugame-maintenance/2026-11-19/`: `catalog-backup-final/` holds the before exports, `catalog-backup-after/` the after exports, and `catalog-release-journal.ejson` is mode 0600 with phase `complete`, 43 intents, 43 acknowledgements and 43 completed operations. The reviewed `catalog-release-plan-final.json` SHA-256 is `988fe273b1111cc141b0dae388b333041a60717df405cc4edf075bbe88918d70`. Keep these files outside Git and retain the completed journal. Public verification and a completed journal do not by themselves establish that backup restoration has been tested.

See [release planning](catalog-release-planning.md) for evidence and dry runs, and the [October writer](catalog-release-writer.md) for its preconditions and recovery procedure. That writer accepts only the fixed October 43-operation plan. A later release requires fresh official evidence, lossless exports, a reviewed plan and separately reviewed writer support; changing the planner's manifest does not make the current writer suitable for another release.

The [official v1.03 teaser](https://www.youtube.com/watch?v=Jja7HusBVzc) announces November 24, 2026, with an earlier IAAPA preview. As of this runbook's verification date, that content must not be represented as generally released. Recheck the official release notice on or after release rather than promoting a draft automatically.

## Back up, plan, apply, verify

1. Record the production commit, service status, catalog counts, relevant source versions, and working-tree changes. Confirm which process owns the update; avoid concurrent catalog writers.
2. Create a dated backup of affected collections, including manual overrides, and any media to be replaced. Preserve BSON types and identifiers. Record its location and verify it can be read; test restoration in an isolated database before relying on it. Keep backups and credentials outside Git.
3. Build a dry-run plan from verified release data. Review each insertion and changed field, chart tokens, release history, restrictions, media paths, and preserved manual fields. Reject unexpected deletions, identity changes, unrelated version changes, and future releases.
4. Test on a disposable copy. Confirm incomplete source data is rejected, applying the same release again produces no further changes, and concurrent changes cause a conflict rather than being overwritten. Review the concrete production diff before applying it.
5. Apply with the reviewed tool and compare actual writes with the plan. Re-run the dry run to establish idempotence. Check version-specific counts, provenance, media availability, and unchanged identities, manual audio, and older-version charts.
6. Verify the public API and browser: search each added song; open its details; check artist, BPM, folder, charts, history, premium/restriction information, and jacket. Compare representative Phoenix songs and favorites with the baseline. Check anonymous and authorized signed-in behavior.

Use the [reviewed planner](catalog-release-planning.md) and the release-specific [writer procedure](catalog-release-writer.md). Historically, `.gitignore` excluded `scripts`, while `package.json` advertised import/migration commands. Do not recover and execute an old script without reviewing its source and dry-run behavior. Record the command and revision actually used in the release record.

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

Run relevant tests, lint, the TypeScript check, and a build on the candidate revision before merging. The `main` watcher makes merging a production action. Retain the prior commit, recoverable database backup, and media backup, then verify the timer deployed the expected commit.

The [deployment recovery guide](deployment-recovery.md) records the installed bundle and its separate host-installation requirements. Repository merges do not replace that immutable host bundle; verify the installed command before relying on a newer recovery implementation.

Read-only origin checks include:

```sh
git -C /home/pkimchi/piugame-web-prod rev-parse HEAD
systemctl --user status piugame-web.service --no-pager
systemctl --user status piugame-web-deploy.timer --no-pager
```

Check origin and public behavior, including search, a song detail, a jacket, an audio URL, and an authorized signed-in flow. A protected public request returning a challenge or 403 is not evidence of an application regression; verify through the authorized browser and inspect the origin before changing edge rules.

For recovery, first coordinate the deployment watcher so it cannot replace a restored revision. Git rollback does not restore database writes or overwritten media. Restore only affected data/files from the verified backup, preserve later legitimate changes, and repeat application checks. Do not claim recovery is tested until the isolated restore and intended rollback path actually pass.

### Runtime switch and rollback

**Completed November 19 at 17:19:05 UTC:** production commit `b66a7fca64e1bbf21a25027a455d338151ad5c4d` switched to Node 24.22.3. The npm and Next.js processes use `~/.local/share/piugame-runtime/node-v24.22.3/bin/node`; the service's `ExecStart`/`PATH` and `~/.local/bin/piugame-web-deploy` use the dedicated runtime. The default shell and unrelated bot service were unchanged. Qualification passed all 215 tests, lint, type checks and build, with zero audit findings at that time. Origin/public catalog, icon, optimized-image and WAV-range checks passed; all 63 manual-audio hashes, `.env` and database counts were unchanged. Subsequent public verification confirmed all 21 songs/171 charts, and signed-in home and chart-page checks passed.

The private receipt is `runtime24/runtime-switch-completion.json` under the release-record root above. The same-commit Node 23 rollback snapshot is `/home/pkimchi/Documents/piugame-maintenance/2026-11-19/rollback-node23-b66a7fc/app`. Rollback was not needed or exercised; this procedure does not add automatic health rollback. The reviewed procedure and precondition hashes are in `runtime24/switch-review/`, with qualification logs in `runtime24/`. The steps below describe the Node 23-to-24 switch. For another runtime change, refresh these records, runtime names and snapshot paths against the current configuration; do not reuse an older code snapshot.

1. Install the verified new runtime beside the existing one. In a clean checkout of the exact production revision, install locked dependencies, run tests, Next.js type generation, TypeScript, lint and build, then smoke-test on an isolated loopback port without production credentials. Resolve or explicitly review every failed check before proceeding.
2. Acquire `/home/pkimchi/.local/state/piugame-web/deploy.lock` exclusively and retain its file descriptor through snapshot, switch, checks and any rollback. The timer can remain enabled because the deploy script skips while this lock is held. Recheck HEAD, the deployed marker, clean tracked files, effective service configuration, unexpected drop-ins and every reviewed precondition hash. Abort on drift.
3. Copy the then-current production tree to a private `rollback-node23-<commit>/app` snapshot under the release-record root, preserving `.env`, `.next`, `node_modules`, `public`, modes and timestamps. Record the commit, build ID, all manual-audio hashes and configuration/marker checksums; retain the original unit, deploy script and marker beside it. Verify the copy before changing the service. The November 19 switch limited qualification plus the new snapshot to 6 GiB; set and check a storage allowance before repeating the procedure. Leave retained snapshots and catalog backups untouched.
4. Stop `piugame-web.service` for artifact replacement. Copy only the qualified `.next` and `node_modules` into production, preserving source, media and `.env`; retain the qualification originals. Install the reviewed `90-node24.conf.candidate` as `~/.config/systemd/user/piugame-web.service.d/90-node24.conf` (0644), and atomically replace the deploy script with its reviewed candidate while preserving executable mode. Keep both configuration changes under the same lock. Leave the nvm default, other services and global shell configuration unchanged.
5. Run `systemctl --user daemon-reload` and start the web service. Verify the actual process executable/version and both service/deploy runtime paths, then check localhost:4090 and public health, read-only catalog APIs, image optimization, icon generation, WAV range responses and all manual-audio hashes. These runtime checks do not require account or database writes. The source commit is unchanged, so retain the deployed-commit marker and record the runtime transition separately. Release the lock last.

On startup or health failure, retain the lock and stop the service. Restore `.next` and `node_modules` from the verified **same-commit** snapshot, remove only the new `90-node24.conf` (the recorded original had none), and atomically restore the original executable deploy script and marker. A later switch must restore any pre-existing drop-in instead of assuming it can be removed. Restore the base unit only if this operation changed its checksum; stop and report unexpected concurrent changes. Reload systemd, start the service, verify the old runtime, local/public health, catalog counts and audio hashes, then record the outcome and release the lock. A runtime rollback does not require database restoration.
