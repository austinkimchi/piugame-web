# MyPIU maintenance task ledger

Checkpoint: **November 19, 2026**. The original maintenance request remains active. This ledger covers the requests from the beginning of the maintenance chat through the mobile loading, UI testing and deployment requests. Review it before choosing more work; update milestones and evidence as work finishes. A merged PR, successful build and verified live release are different states.

The current verified website release is `bd3c718` ([web #39](https://github.com/austinkimchi/piugame-web/pull/39)). The mobile artwork fix is merged in `5e7f70c` ([mobile #49](https://github.com/austinkimchi/piugame-mobile/pull/49)); the subsequent Apple Watch roadmap is documentation only ([mobile #50](https://github.com/austinkimchi/piugame-mobile/pull/50)). Loading improvements below are still in review/development at this checkpoint.

## Working rules and priorities

- Primary product: [mypiu.austin.kim](https://mypiu.austin.kim), backed by `austinkimchi/piugame-web`. Continue the newer `austinkimchi/piugame-mobile` work without abandoning catalog, audio and asset maintenance.
- Coordinate with **Set up piugame-mobile project** on `slim7prox`. Keep the original maintenance chat and that remote chat pinned. Both were verified pinned on November 19.
- Use parallel isolated worktrees and parallel PR checks. The user permits up to ten local helpers; the available runtime may support fewer. Use slim7prox for suitable Linux/Android checks, with bounded resources that leave the live web and bot services capacity. Do not enable fast mode.
- Commit style: short lowercase conventional subjects such as `feat:`, `fix:`, `docs:` and `ci:`. Branches use `feature-...` or `fix/...`.
- Release workflow: create a PR, obtain automated Codex review for the exact head, fix actionable findings, pass relevant checks, squash merge, and delete only the exact reviewed merged branch. Rebase dependent stacked branches after a parent squash and recheck their new heads.
- Merging web `main` triggers the existing minute-by-minute deployer. Verify each rollout. Batch compatible reviewed changes when practical: the verified single-instance switch currently interrupts origin service for about 92 seconds. Do not mistake CI success for deployment success.
- Payments require separate authorization. The user declined Apple membership renewal for this update and chose a temporary Google-only device build.
- Discord is strictly read-only. No typing or sending. Google/MyPIU account use and necessary Cloudflare access are authorized for testing and maintenance; keep credentials out of Git, logs, fixtures and reports.
- Existing PIUGAME credentials may be used if required; do not expose them or retrieve/decrypt them unnecessarily.
- Preserve curated audio, Mongo identifiers/manual overrides, later legitimate user writes, original Xcode signing edits, unrelated services and retained recovery backups.
- Keep storage bounded. Reuse installed simulators, remove disposable build outputs after use, and do not remove retained backups or uncertain work to save space.
- At most one authorized free usage reset expires December 1 at 11:46 PM GMT+1. No reset was redeemed by this maintenance agent. After the usage-limit interruption, a fresh account check allowed ordinary usage again and listed one remaining reset expiring December 12; do not redeem that different reset or infer permission for paid credits or a second reset. Check current account state before any further reset action.

Finish the active catalog/mobile performance changes through their review and release gates. In parallel, return to the earliest unfinished original work: verified audio completion, asset usage/completeness, and remaining architecture/Workers mapping. Future Apple Watch and database redesign must not displace those tasks.

## 1. Learn the website and coordinate maintenance

**Completed:** the [maintenance runbook](maintenance.md) maps the Next.js origin, data ownership, catalog/source collections, versioned charts, admin media uploads, performance data, mobile integration, runtime and deployment. GitHub tools are available; a separate plugin installation was unnecessary. Repository documentation and this ledger provide the durable project context.

**Remaining:** inspect the authenticated Cloudflare account to map the relevant Workers, routes and tunnels. The public domain and the actual systemd/Next.js origin on port 4090 are verified; a complete Cloudflare account inventory is not. Review the SDK's broader API/documentation and integration boundaries separately; successful app builds do not establish a full SDK audit.

**Coordination:** local chat `01a1f480-a246-7120-bac3-b1168d457689`; remote chat `01a0cd11-1e8a-71a0-9966-3083a990ef36`, host `remote-ssh-discovered:slim7prox`. Helpers report concrete evidence and unresolved gaps to the main maintenance chat. Do not assume a helper's local test proves production behavior.

## 2. Verify and update released songs and charts

**Completed and live:** the October 15 Phoenix 2 release was verified against official notices/chart evidence, then applied with a reviewed backup, plan and recoverable writer. There were 43 operations: 21 new songs in each of the unified and Phoenix 2 source catalogs, plus Hello William D20 history. The additions contain 171 charts. A subsequent dry run produced no changes. The unified catalog contains 697 records; 675 support Phoenix 2 and 639 support Phoenix. Existing manual overrides and all 63 manual audio hashes were preserved.

Evidence: [release planning](catalog-release-planning.md), [writer procedure](catalog-release-writer.md), [web #29](https://github.com/austinkimchi/piugame-web/pull/29), [web #33](https://github.com/austinkimchi/piugame-web/pull/33), and the private before/after exports and completed journal described in the runbook. The laptop's `catalog-verification.json` and `new-catalog-verified.jpg` record public verification.

**Remaining:** continue checking official notices for releases after the verified October update. The November 24 v1.03 teaser was still a future release on November 19; do not publish it as generally available before its release is verified. Historic series routes exist, but the current database has no supported/removed membership for XX, PRIME2, PRIME, FIESTA, NX or zero–1st. Do not present those empty views as a fully backfilled historical catalog.

**Friend's chart suggestions:** the supplied screenshot mentions Antique Serenade S18 (full twist), Because of You S18, New Rose S19, Chess and Chase D18, Dizzy Dance D18 and Under the Christmas Stars D19. The saved catalog includes the requested chart token for each corresponding record; the second is currently spelled **Becouse of You** by Srav3R & USAO. Verify that spelling against an authoritative source and address search discoverability without breaking existing slugs/favorites. The “full twist” description is not independently verified. The Discord conversation itself has not been audited in this pass. Do not turn suggestions into favorites or other account writes without a task reason. The unrelated Grammy screenshot is not release evidence for PIU.

## 3. Match the existing audio workflow and finish missing previews

**Completed:** inspected the existing Ableton-style exports and media pipeline; repaired preview/range behavior and the handling of confirmed missing files. Several inspected manual WAVs are ten-second, stereo, 48 kHz, 24-bit PCM exports; peaks vary. Existing files were preserved rather than renormalized.

**Unfinished:** the verified worklist contains **53 songs without previews**, including the 21 additions. No exact-cut audio was fabricated for those additions. `%X (Percent X)` by Pory has a curated WAV reference whose file is missing and returns 404. An older MP3 exists, but its cut and normalization are unverified and it was not substituted.

Next steps for each candidate: record the source video, identify the exact in-game preview start/end by listening, compare export settings and normalization to curated examples, export with Ableton or an equivalent reproducible method, inspect clipping/cut boundaries, upload, and verify content type, range bytes and playback after deployment. If confidence is insufficient, leave that specific clip for the owner's manual completion. This permission to defer uncertain clips does not mean audio maintenance is finished.

Evidence: laptop `audio-preview-worklist.html`, `audio-preview-worklist.json`, `missing-preview-verified.jpg`; [runbook audio section](maintenance.md#audio-and-jackets); [web #28](https://github.com/austinkimchi/piugame-web/pull/28), [web #34](https://github.com/austinkimchi/piugame-web/pull/34).

## 4. Scrape and organize important game assets

**Completed:** 287 verified official PNG assets, totaling 8,583,238 bytes, are organized by game/version/category with provenance, hashes and a browsable index. The collection includes normal/failed grades, stepballs and available numeric glyphs, plates, guide assets, pad arrows and medals. The assets and lookup helper are in [web #31](https://github.com/austinkimchi/piugame-web/pull/31); the repository manifest is `public/assets/piu/ui/manifest.json`. Laptop exports include `piu-game-assets.zip` and `piu-game-assets/index.html`.

**Unfinished:** 18 candidate URLs were unavailable and are recorded in the manifest. This is an inventory of verified official web assets, not an exhaustive extraction of arcade software. Audit missing numeric/stepball families against actual official references rather than claiming every asset was obtained. Integrate selected grades/plates/stepballs into useful web/mobile views with accessible text alternatives and consistent sizing; scraping alone did not complete that eventual UI request.

## 5. Keep both GitHub repositories organized

**Completed:** both READMEs were simplified with badges and setup/docs links, following the user's calendar-hours and Custom-ISA examples; rendered results were checked. Repository descriptions/homepages/topics were updated. Reviewed changes have used PRs and conventional squash subjects. Recently merged working branches were deleted using exact-head checks.

**Remaining:** finish all active PRs through review and cleanup. The older web branches `feature-google-seo` and `feature-piu-versioning` have ambiguous/unmerged provenance; do not delete them merely because they are old. On slim7prox, 29 inactive worktrees were archived with their sources/local branches/APKs, which is not equivalent to reconciling or merging their work. Audit those archives and older PRs before further deletion.

CI now includes relevant web checks and scoped mobile platform checks, cancellation/concurrency limits, timeouts and short artifact retention. At the November 19 billing check, included Actions compute was $0.02 of $18, storage was 0.3 of 2 GB, billable usage was zero, and paid Actions usage was blocked by a $0 budget. These are dated observations; recheck billing before changing paid settings or increasing costly hosted work. Android/iOS/macOS release credentials, store enrollment and physical distribution qualification are not implied by CI setup.

## 6. Storage and infrastructure

**Completed:** temporary build/dependency outputs were removed when unused; existing simulator runtimes were reused. The latest observed laptop free space was about 72 GiB, and slim7prox had about 160 GiB free. Recheck current values rather than treating them as fixed budgets. Preserve the owner's pre-existing dirty mobile Xcode project file.

**Mongo SSH completed:** `ssh mongo` was repaired on slim7prox. Client key/config permissions were corrected, a malformed/wrong server authorized key was replaced with the intended public key after backup, and SSH was configured for public-key authentication only. Fresh key-only access succeeded; password and keyboard-interactive access were rejected. `mongod` and SSH remained active. The temporary OS password was not changed; password SSH was disabled. No Mongo private key was copied to the Mac. From the Mac, the verified route is `ssh -t slim7prox ssh mongo`. Laptop evidence: `mongo-ssh-repair.json`.

**Catalog backup completed:** the laptop has an 8,728,879-byte archive of nine catalog/reference collections and their metadata/index definitions, containing 25,607 documents. SHA-256: `7ae28a607a20483981723072e28db3574b8e44e178932adbec175390b6f9389f`. All 31 member checksums, BSON framing/counts and EJSON counts were verified locally. Remote exact BSON/EJSON roundtrips and three matching sorted captures were also recorded. The archive excludes accounts, authentication, sessions and personal performance data; it records references/hashes for the 63 manual audio files without duplicating the corpus.

**Backup limitation and next step:** no restore drill has been performed. Repeated-read consistency is not a transactional point-in-time snapshot. Review `RESTORE.txt` and prove an isolated empty-database restore before relying on a destructive database operation. Keep both the laptop archive and remote backups/journal.

**Database work deferred:** MongoDB remains 5.0.8 standalone. Measure the real bottleneck before upgrading or changing schema. The user permits a justified MongoDB version/schema change with backups; migration to a different collection/storage technology requires discussing the rationale with the user first. No migration is approved or implemented.

## 7. Deployment and live web reliability

**Completed and exercised:** Node 24.22.3 is installed separately for the web service/deployer; unrelated shell defaults and the bot remain unchanged. Dependency/security updates, CI lint fixes, OAuth identity checks and pagination/history bug fixes were merged. The durable recovery driver was separately installed as an immutable bundle, outside the mutable app checkout, under the existing deployment lock.

The first full deployment failed safely during fresh artifact fsync, before promotion. A fresh full-size reproduction took about 180 seconds against a 120-second budget. Four bounded workers preserve every file/directory durability barrier and settle started work before recovery; the revised whole-copy benchmark completed in 81.176 seconds with identical contents. Qualification passed all 53 Linux focused tests. [Web #39](https://github.com/austinkimchi/piugame-web/pull/39) passed CI and exact-head review; normal timer promotion to `bd3c718` then succeeded. Origin/static bytes/catalog/images/audio ranges and all 63 manual audio hashes passed; the bot and environment were unchanged. The next ordinary timer reported the release current.

**Limits:** the normal promotion is proven, and isolated recovery tests pass; a real live post-promotion rollback was not deliberately exercised. The single-instance stop/snapshot/switch caused an observed 91.55-second interruption. Reduce that downtime in a separately reviewed deployment improvement; do not weaken durable recovery or call the present rollout zero-downtime.

**Live UI fixes completed:** accessible search naming remains correct with text present; ORIGINAL selection no longer removes other folder choices, and ORIGINAL + K-POP works. Verified signed in after rollout and restored the original filters. Evidence: laptop `folder-filter-after.jpg`, `deployment-rollout-2026-11-19.json`, `deployment-linux-53-tests.json`, `deployment-fresh-copy-benchmark.json`.

**Known web UX follow-ups:** “Recently played” shows latest-session size while its destination contains wider history. The chart performance carousel deliberately hides attempts newer than the best result; distinguish Best/latest/history rather than treating those attempts as missing database data. Confirm improved labels/navigation with the user flow and tests. A previous clear-search failure was a test artifact caused by an unclosed modal and was retracted.

## 8. Remove public catalog transport pagination

**In review/development, not live at this checkpoint:** [web #40](https://github.com/austinkimchi/piugame-web/pull/40) adds complete public snapshots, GET/HEAD, strict public field allowlists, ETag/304, single-flight loading and bounded cache freshness. It excludes credentials, personalization and filesystem audio paths and returns a no-store error rather than presenting the 250-song fallback as complete. All eight existing series route values are supported; empty historical data remains explicit.

[Web #41](https://github.com/austinkimchi/piugame-web/pull/41) hydrates a full public snapshot, filters/sorts locally and bounds mounted cards while retaining keyboard focus. Favorites and mode-specific chart suggestions remain private. Preserve existing source slugs and legacy community-storage aliases consistently in search, favorites, notes, toggles and detail endpoints. The API review found an alias GET/POST mismatch; the fix received regression tests and a new exact-head review.

Evidence so far: roughly 68 KB gzipped for the Phoenix 2 public DTO versus up to 29 current UI page requests. Local query benchmarks are below one millisecond, but are not a production browser load-time claim. Public fixture tests covered 390/768/1618-pixel layouts, folder combinations, long titles, empty-search recovery, no network search per keystroke, fast scrolling and focus retention. Authenticated end-to-end, admin mutation, error/offline and post-deploy checks remain necessary.

Release gate: finish reviews/CI, rebase stacked branches after the parent squash, verify their exact new heads, merge, observe the automatic rollout, measure public and signed-in behavior, then clean branches. Do not remove pagination from inherently private recent/recommendation feeds merely because public catalog transport is changing.

**Public catalog CORS follow-up — candidate tested, not merged/deployed:** the isolated `feature-public-catalog-cors` branch from `96d0b365` limits anonymous wildcard CORS to `/api/catalog/v1`, adds database-free OPTIONS, and preserves private APIs. Chromium 153.0.8010.12 passed a real two-origin loopback test of GET/HEAD/304, If-None-Match preflight, readable errors, and blocked credentialed/private reads. See [the public API contract and portable browser qualification](public-catalog-api.md#browser-qualification); deployment verification remains separate.

## 9. Mobile images, device update, loading and UI tests

**Artwork fix completed:** Home recent-play rows and their detail presentation now use the existing catalog fallback when server/local snapshots omit images, preserving server and snapshot precedence. [Mobile #49](https://github.com/austinkimchi/piugame-mobile/pull/49) passed 36 targeted tests, iOS CI, automated review and signed-in Simulator before/after checks. Home and detail screenshots are saved locally.

**One-time personal iPhone update completed:** version 0.1.0, build 2 was installed in place and launched on iPhone r. The owner's developer membership was expired; after the user chose the no-payment option, a throwaway build omitted Apple sign-in capability/UI and retained Google sign-in, the existing app ID/team and app data. Production source/entitlements and original signing edits were preserved. Physical Home showed the retained account and GOOD NIGHT, Conflict and YOU AND I jackets. Physical detail verification stopped when the user chose to inspect the phone themselves because Mirroring was misbehaving. Do not resume phone control without a new request. Evidence: laptop `mobile-artwork/iphone-install-receipt.json`.

**Urgent loading work active:** authenticated Songs currently waits for 23 Phoenix 2 pages, or 22 Phoenix pages, before its first cold result; iOS artwork preload uses 45 sequential requests across both versions. Fix prompt first-page/cached rendering, background refresh, full-snapshot caching, ETag handling, coalesced loads, accurate cache/error labels, cancellation and latest-request handling. Never cache a capped/partial cursor walk as complete. Preserve private favorites/recommendation hints rather than dropping them to adopt the public API.

**Sessions and image work active:** [mobile #51](https://github.com/austinkimchi/piugame-mobile/pull/51) adds account-scoped in-memory Sessions retention, immediate clearing on identity changes, refresh/pagination generation guards, preserved rows plus retry on transient failures, and shared in-flight image requests. Android counterparts and meaningful race/privacy tests are included. Local iOS tests passed; hosted checks and exact-head review are still release gates. Existing image disk-cache behavior is preserved; persistent session caching and moving image decode off the main thread must not be claimed without implementation/evidence.

**Private overlay active:** a separate backend mobile endpoint is being developed to return only the authenticated user's favorite slugs and per-mode recommendation tokens, allowing complete public snapshots plus one private overlay instead of serial authenticated pages. It reuses shared recommendation/alias helpers, uses existing bearer authentication, and keeps every response private/no-store. Keep client state scoped to account/version and reject stale responses after sign-out, account switch or favorite changes. Existing ranked feeds remain separate.

**Mobile release gate:** complete iOS and Android checks, test cold/warm/offline/error/account-switch flows and visible UI behavior in existing simulators, address review findings, merge reviewed commits and document remaining device limits. The initial device installation is done; later performance changes are not automatically present on the phone. No App Store/TestFlight/Play publication is claimed.

## 10. Future Apple Watch idea

**Recorded, not implemented:** [mobile #50](https://github.com/austinkimchi/piugame-mobile/pull/50) adds the [Apple Watch feasibility roadmap](https://github.com/austinkimchi/piugame-mobile/blob/main/docs/apple-watch-workouts.md). It covers an explicit MyPIU workout, manual song/rest markers, movement-assisted interval suggestions, optional short ShazamKit samples/custom signatures, three-song rounds without hardcoding that assumption, HealthKit versus WorkoutKit integration, background limits and physical-watch battery measurements.

Start with manual workout recording if this reaches implementation. Do not promise automatic recognition, a new system-wide activity category, background always-listening or a battery percentage. No watch target/runtime was installed. Keep this behind current catalog, audio, asset, mobile reliability and storage work.

## Active owners and next handoff

| Work | Owner | Next concrete outcome |
| --- | --- | --- |
| Original-request ledger, live verification and release order | Main maintenance chat | Keep this scope current; batch compatible reviewed releases; return to audio/assets/Workers gaps |
| Public catalog API and mobile private overlay | slim7prox chat and its isolated helpers | Finish exact-head review, integration and authenticated/public endpoint verification |
| Web local filtering, private aliases and bounded rendering | Web regression helper | Complete web #41, rebase after parent squash, verify private/admin flows and live rollout |
| Mobile Songs/public snapshot/cache loading | Mobile audit helper | Tested prompt cached/first-result UI, complete snapshot + private overlay integration |
| Mobile Sessions and shared image requests | Sessions helper | Finish mobile #51 CI/review, check UI/error/account switching, merge and clean branch |
| Audio cuts and asset integration | Main chat after current release work | Verify source/cut/export per clip; integrate selected official UI assets; retain explicit manual gaps |

Before the next handoff, read this ledger and the runbook, inspect current PR/live state, report completed versus pending items separately, and update evidence only for work actually verified. Keep the overall maintenance goal active while requested work remains.
