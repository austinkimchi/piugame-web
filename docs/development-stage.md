# MyPIU development stage

Prepared November 19 and verified November 20, 2026, at source **532bbc4**. The Next.js dev service is separate from production; it uses Turbopack and hot refresh rather than a production build for ordinary edits. No Vite migration or public Cloudflare development route was created. The laptop receipts `next-dev-stage-qualification.json` and `deployment-timer-one-minute.json` record the checks. See also the [maintenance runbook](maintenance.md) and [production recovery procedure](deployment-recovery.md).

## Open and control it

On the Mac, open **http://localhost:4080** while the task-owned SSH tunnel is running. The current tunnel control socket is `/tmp/mypiu-dev-ssh-austinkim.sock`; it does not survive a reboot.

```sh
# Check or close the Mac tunnel.
ssh -S /tmp/mypiu-dev-ssh-austinkim.sock -O check slim7prox
ssh -S /tmp/mypiu-dev-ssh-austinkim.sock -O exit slim7prox

# Start it again if no process already owns local port 4080.
ssh -M -S /tmp/mypiu-dev-ssh-austinkim.sock -fNT \
  -o ExitOnForwardFailure=yes -o ServerAliveInterval=30 \
  -L 127.0.0.1:4080:127.0.0.1:4080 slim7prox

# On slim7prox: manual service control.
systemctl --user start piugame-web-dev.service
systemctl --user status piugame-web-dev.service --no-pager
systemctl --user stop piugame-web-dev.service
# Optional when finished: also stop only this task's database.
docker stop piugame-web-dev-mongo
```

The unit is deliberately **not enabled at boot**. Its `ExecStartPre` starts the existing task Mongo container; Docker must be available. Boot ordering/restart persistence has not been qualified. The dev server is bound to `127.0.0.1:4080`; Mongo is published only on `127.0.0.1:27018` with a new task-only credential. Production stays on port 4090.

## Source changes and hot refresh

The independent checkout `/home/pkimchi/piugame-web-dev` tracks the stable GitHub branch `feature-dev-stage`. Production watches **main**, so feature edits must go to staging first and be promoted to main separately after their appropriate review/tests.

```sh
# On slim7prox, recommended for ordinary source changes:
~/.local/bin/piugame-web-dev-pull

# The underlying non-destructive pull, when intentionally working manually:
cd /home/pkimchi/piugame-web-dev
git status --short
git branch --show-current       # must be feature-dev-stage
git pull --ff-only
```

The helper has its own update lock, rejects local source changes, unexpected upstreams, main/master, non-fast-forward updates and staged environment files. It refuses registry, dependency or configuration changes so they can receive explicit review and an intentional dev restart. It also refuses updates below 10 GiB free disk or above an 8 GiB checkout size; these are update-time guards, not filesystem quotas. It does not reset or discard work. Keep one writer for the stage checkout.

For an intentional dependency/config update, first preserve any local edits, stop only the dev service, fast-forward the staging branch, run `npm ci --no-audit --no-fund` with the dedicated Node 24.22.3 runtime if dependency files changed, then restart dev. Package installation uses existing user-level package authentication; never copy it into this checkout. Ordinary source-only changes are watched by the already-running service.

A disposable task-local Git remote was used to verify two real fast-forward pulls: an open browser changed from check A to check B, then back to A after a committed revert, without navigation/reload or a service restart. The fixture/remote were removed afterward. This proves the pull/HMR mechanism without adding test commits to main or the stable staging branch.

After production release **532bbc4** was healthy, staging advanced from **924061b** only after proving it had no independent commits, checking ancestry and the exact remote branch head. The guarded pull retained dev PID **897443**. A fresh local browser then showed the updated modal: initial close-button focus, full removal on Escape and an interactive reopened dialog. All 40 mounted jacket images loaded. Future independent staging commits must be preserved and merged deliberately; do not reset the stage to main to bypass divergence.

## Data and resource boundaries

- A verified catalog-only transfer was restored from **raw BSON** into the task-owned Mongo container: nine public/reference collections, 697 catalog records, 675 Phoenix 2 and 639 Phoenix. No account/session database was restored. The separate community database starts empty.
- The fresh `.env.local` contains only the task Mongo URI, public catalog/community database selections and `NEXT_PUBLIC_SITE_URL=http://localhost:4080`. Production `.env`, OAuth and PIUGAME credentials were not copied. The service uses `env -i` so it does not inherit shell/manager credentials.
- The repository's tracked `.npmrc` is a registry setting plus an environment-variable auth-token placeholder; it contains no literal credential. The user's private npm configuration remains outside the checkout and service unit.
- Signed-in account, Google/Apple OAuth, PIUGAME linking and browser-extension flows are **not staged**. The extension's production origin remains hardcoded; do not direct it to this empty dev account database or reuse production session cookies.
- Next dev: 2 CPU cores of quota, 3 GiB memory high watermark, 4 GiB hard maximum, 256 tasks and lower scheduling priority. Mongo: 1 CPU, 1 GiB hard maximum and 0.25 GiB WiredTiger cache. The initial dev process used about 756 MiB. Configured source/state paths and the dev update lock are separate from production. The Node service runs as the same Unix user, so this is configuration/data separation, not an operating-system sandbox against malicious code.
- State belongs to `/home/pkimchi/.local/state/piugame-web-dev`; Mongo data stays in its task-owned bind directory. Docker also created a task-owned anonymous `/data/configdb` volume attached to this container. No production or private backup directory is mounted in the container. Do not remove state while its container is running. If retiring the stage, stop its service/container and inspect these exact mounts before removing only task-owned state and the attached anonymous volume. Stop dev/Mongo when unused; cache/disk use needs periodic measurement, not an assumed permanent bound.

Initial compilation measurements: full Phoenix 2 API ready in **1.49 s** after starting dev; first homepage request **3.95 s**. These are single local samples, not production speed guarantees. Production remained on its existing PID during initial setup and HMR qualification.

Final warm checks returned home HTTP 200 in **0.259 s**, Phoenix 2 API 675 in **0.036 s** and Phoenix API 639 in **0.050 s**. The dev process remained unchanged across the actual release pull; peak observed memory was about 1.08 GiB. Checkout size was 2.14 GB, public BSON seed 55.3 MB and Mongo data 326.4 MB; host free disk was about 163 GB. These are point-in-time measurements. The app initialized eight empty community collections but no account/community documents.

## Public media

All **2,269** public asset files (778,542,876 bytes), including all **63 manual audio previews**, already matched production byte-for-byte in the independent Git checkout. No additional copy was necessary. Every asset is a regular file with a different inode from its production counterpart; no live media directory is symlinked or shared. The B3 1,024-byte preview range returned matching HTTP 206 bytes on dev and production. The existing missing `%X` original remains missing; no substitute or new audio was created.

The host's task-private `media-refresh.json` records the relative paths, sizes and hashes. Refresh future public media only after checking the source paths and hashes, copy into dev-owned regular files, and recheck both source and destination. Do not copy environment files, account data or whole private backup directories. Newly copied media should be read-only; preserve any intentional stage edits and review Git conflicts instead of overwriting them. The final verification left production media/environment unchanged and production running at **532bbc4**, PID **902550**, with no pending transaction.

## Optional remote browser access

The current SSH tunnel is the supported path. A future Cloudflare development hostname would need a separate reviewed tunnel ingress plus Access protection and exact Next dev allowed-origin configuration, with the same isolated data boundaries. It must not replace the live `mypiu` route or expose an unauthenticated development server. No such hostname, Access application or OAuth callback change was made here.

## Production build-cache follow-up

The installed Next 16.4.5 documentation describes default dev filesystem caching in `.next/dev/cache/turbopack` and build caching in `.next/cache/turbopack`. The production driver currently builds a fresh staging checkout without restoring the prior build cache; the observed production Turbopack cache was about 97.9 MB.

A separate reviewed driver improvement could retain only the build cache from a trusted successful main build, keyed by runtime/platform, dependency lock and build configuration/public environment. Restore it into the same staging path, keep a hard size budget, and fall back to a cold build on corruption or mismatch. Keep runtime image/data caches, production environment, community data and dev-branch caches out of that store. Preserve command sentinels, disk checks, fresh build outputs, readiness, snapshots and rollback. Publish any new cache only after the deployment completes; never use it as rollback evidence.

The isolated same-source experiment subsequently measured cold/warm full builds at **26.695/17.501 seconds**, with **0.718 seconds** of cache restore/publication overhead. The roughly **8.48-second** net potential is only about 4.3% of the latest 198.86-second deployment if it transferred directly; no live optimized rollout was attempted. Provenance mismatch and corruption rejection followed by a successful cold fallback were checked. The production cache change is **deferred and not installed**: it adds durability/recovery complexity while leaving media preservation and the single-instance switch unchanged. The new dev stage already removes production rebuilds from the ordinary edit/refresh loop. Laptop assessment: `turbopack-build-cache-assessment.md` and its JSON receipt.

Native Swift/Kotlin changes still use Xcode/Gradle incremental compilation and Simulator/emulator/device testing; web HMR cannot replace their builds. Existing simulator, DerivedData and Gradle caches can be reused within their current build configuration, with a full relevant test/build gate before a release.
