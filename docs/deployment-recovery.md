# Host deployment recovery

## Installation status

Installed and verified on **November 19, 2026**: the watcher uses the immutable
bundle from reviewed head `baf9b5631a30bcfaa5280d48f20ba5b73c2371c7`, installed under
`~/.local/lib/piugame-web-deploy/` outside the application and recovery trees.
The launcher SHA-256 is `998bd4271c6b16701bd2b2eff02f13d28e8e2c7419a7c90b043c2c5a9bf669e3`.
Installation retained the same existing deployment lock across the source merge
and atomic launcher replacement. The ordinary timer then deployed `bd3c718`,
and the next timer reported it current.

Qualification passed 53 of 53 isolated Linux tests. A fresh full-runtime copy,
durable inventory and verification took 81.176 seconds within the 120-second
budget. The first normal live promotion with this bundle succeeded; it caused
about 92 seconds of single-instance interruption. Origin/static/catalog, public
image/audio checks, all 63 manual-audio hashes, environment and unrelated bot
checks passed. A real live post-promotion rollback was not deliberately tested.
Private receipts are under `deployment-install-baf9b563/` in the November 19
maintenance directory; the initial safely failed `9318d1e` deployment evidence
was retained separately.

Merging future repository changes does **not** replace this installed bundle.
New recovery code still requires a separately reviewed host installation and
verification. The [runtime switch record](maintenance.md#runtime-switch-and-rollback)
describes the earlier runtime transition; the [task ledger](maintenance-plan.md)
tracks remaining maintenance and release work.

Install these three reviewed files together in a fixed directory outside the
application checkout:

- [`scripts/deploy-web.mjs`](../scripts/deploy-web.mjs): orchestration and recovery.
- [`scripts/deploy-command.mjs`](../scripts/deploy-command.mjs): child-process supervision.
- [`scripts/deploy-files.mjs`](../scripts/deploy-files.mjs): file preservation and durable state.

The deployer must survive a checkout reset and rollback; do not invoke a mutable copy from `main`.
Retain the previous executable deploy script and record the installed bundle's
commit and hashes. Coordinate installation under the existing deployment lock;
preserve the timer, application path, Node runtime and deployed-commit location.
Do not change the service, runtime or storage layout as part of installing this
code. Record the actual installed paths and verification result before treating
recovery as available in production.

## CLI and configuration

Invoke the installed `deploy-web.mjs` with the dedicated Node executable used by
the service. Its supported options are `--check`, `--force`, and
`--config /absolute/config.json`. `--check` validates paths and the systemd/runtime
contract without creating state or taking the deployment lock; it also refuses
an orphaned command record. It does not build, prove application health, or
perform pending recovery. Normal execution acquires
the lock and performs the deployment or recovery. `--force` bypasses only the
current-commit and failed-commit short circuits; it is not a repair command.

The optional JSON file accepts only the following reviewed public settings.
Keep credentials out of it. Paths must be absolute, canonical and separate;
application and state directories must support same-filesystem artifact renames.
Linux, systemd, Git, GNU `cp` and `flock` are required.

| Setting | Default |
| --- | --- |
| `appDir` | `/home/pkimchi/piugame-web-prod` |
| `stateDir` | `/home/pkimchi/.local/state/piugame-web` |
| `service` | `piugame-web.service` |
| `origin` | `http://127.0.0.1:4090` |
| `host` | `mypiu.austin.kim` |
| `siteUrl` | `https://mypiu.austin.kim` |
| `minimumTotal` | 300 songs; must be greater than the 250-song fallback cap |
| `maxManagedBytes` | 6 GiB; cannot be raised above 6 GiB |
| `reserveBytes` | 1 GiB free-space reserve |
| `commandTimeoutMs` | 60,000 |
| `installTimeoutMs`, `buildTimeoutMs` | 300,000 each |
| `copyTimeoutMs` | 120,000 per tree-copy operation or complete snapshot verification |
| `stopTimeoutMs` | 100,000 for service stop/start commands |
| `healthTimeoutMs` | 60,000 readiness retry window |
| `killGraceMs` | 1,000 before escalation from termination to kill |

The origin must be loopback HTTP; the public site URL must be HTTPS. Build-time
`NEXT_PUBLIC_SITE_URL` comes from `siteUrl`, and `MONGODB_URI` is empty during the
staged build. The command environment retains the session variables needed for
the user's systemd bus and SSH agent. A provided `GITHUB_PACKAGES_TOKEN` is passed
only to package installation. The deployer does not copy application environment
files into staging.

## What a deployment preserves

- `.env` stays in the application directory and is not copied into the build
  checkout or restored from a deployment snapshot.
- Database contents, accounts and catalog changes are not rolled back. The
  deployer does not run catalog migrations.
- Manual audio under `public/assets/piu/{phoenix,phoenix2}/audio_previews/manual`
  is captured before promotion. Live files win path collisions, while distinct
  new manual files from the candidate remain available. On normal candidate
  failure, the service is stopped and the freshest full media tree is captured,
  including uploads accepted during health checks. Rollback restores that durable
  capture exactly. Unexpected service restarts during an interrupted switch need
  operator review as described below.
- The prior source revision remains reachable through a protected Git ref, and
  copied `.next` and `node_modules` supply the matching prior runtime artifacts.
  A rollback uses this deployment's snapshot, not an older maintenance backup.

The staging checkout installs locked dependencies and builds while the current
service remains available. The service then stops while its frozen `.next`,
dependencies and media are copied and verified. Production source and artifacts
change only after that snapshot and the `switching` record are durable. This
reduces downtime; it does not promise zero downtime.

## Operation and recovery

The existing exclusive deployment lock serializes timer and operator invocations.
An orphaned durable command record stops a new invocation before recovery, fetch
or mutation: command completion must be established by operator inspection.
Otherwise, a pending deployment is recovered **before** fetching, deciding that
the marker is current, or suppressing a failed commit. State lives under
`stateDir/recovery/`: `pending.json`, `inflight.json`, `failed.json`, one retained
`snapshot/` and temporary `transaction/` files. The existing `stateDir/deploy.lock` and
`stateDir/deployed-commit` remain in use.

`inflight.json` is published durably before a Git mutation, package install/build,
file-copy command or service start/stop. It records only schema, operation, phase
and time, without PIDs, arguments, environment or output. The record is cleared
and the directory synced only after command cleanup is confirmed. Service
start/stop additionally require a read-only systemd state check with no pending
manager job or control process. A failed start with a verified stopped service
can roll back; an unverified stop retains its record and never issues a restart.
Its survival
across a crash deliberately requires inspection; neither `--check` nor `--force`
can bypass it.

| Durable phase | Recovery behavior |
| --- | --- |
| `staging`, `preparing` | Source/runtime are still unchanged; restart and verify the prior application, then remove incomplete staging/snapshot state. |
| `switching` | Restore the verified prior source/artifacts and initial captured media, provided the service stayed stopped and source ownership is unambiguous. |
| `running` | Stop the candidate, durably capture its latest media, and restore the prior application. |
| `restoring` | Continue from the durable media capture; do not replace it with a partially restored tree. |
| `restored` | The old application may have accepted uploads; stop and recapture before repeating recovery. |
| `committed`, `recovered` | Validate the terminal source/marker identity and health, then finish cleanup. |

A candidate marker written just before a crash does not establish success on its
own: an unfinished `running` phase rolls back even if the marker names the
candidate. Recovery stops instead of overwriting ambiguous files or state.

Readiness checks use the origin's HTML, a matching static asset and anonymous
Phoenix 2 search JSON. The catalog total must match the healthy pre-deployment
baseline and meet the configured minimum; an HTTP 200 fallback catalog is not
sufficient. Rollback validates shape and the minimum against the current catalog,
without requiring the old count, because database changes are preserved. Only
successful readiness permits the atomic deployed marker update. Pending state
and transaction files remain until the terminal transition is durable; the
snapshot is retained until the next managed deployment replaces it.

If a candidate fails readiness, stop it and capture the freshest manual media
before restoring the previous source and artifacts. Restore the previous marker
and verify the previous service. Never restore `.env` or database contents to make
a code rollback pass. Retain failed-deployment evidence and back off repeated
attempts of the same failed SHA. Suppression has no timed expiry: a newer SHA is
eligible normally, or an operator can explicitly retry with `--force` after
investigating the failure. `failed.json` keeps the failed SHA, time and a bounded
phase/operation/reason/exit-code summary. Raw command output and environment are
not persisted there; it is not a complete install or build log.

## Limits and operator intervention

Review the defaults above before installation. Readiness requests each have a
five-second timeout and bounded response sizes; the retry window is not a strict
wall-clock deadline for a request sequence already in progress. Child output is
limited to 4 MiB per command. Timeouts terminate the command group and escalate
to kill after the grace period. If a process cannot be confirmed dead, guardians
retain the deployment lock for operator inspection rather than permit a second
writer. A stop timeout is not proof that the service has stopped.

Artifact inventories use four bounded file-I/O workers. Every file still receives
its checksum and required sync; directory barriers run only after all files are
durable, with each child depth completed before its parents. A failed operation
stops dispatching new work and waits for every started operation before returning
the error. Snapshot verification shares one deadline across runtime and media.
Failure receipts distinguish staged artifact inventory, source/destination
inventory and snapshot verification from the install/build commands.

The storage allowance covers `stateDir/recovery/`, not the production application
or separately retained maintenance backups. Initial admission reserves the
remaining managed allowance plus free-space reserve; install/build/copy commands
are monitored during execution. This is a checked allowance, not a filesystem
quota, so transient usage can exceed it before termination. Insufficient space or
an incomplete snapshot prevents promotion. Retained recovery data is not discarded
to make a failed operation fit.

The recovery journal, media capture and snapshot are operational evidence. Do not
delete or edit them to bypass recovery, and do not remove a lock file to assume a
running deployment is unlocked. Unexpected path/source drift, missing or damaged
recovery artifacts, a failed service stop, or unsuccessful recovery requires
operator inspection under the same deployment lock. Preserve the evidence before
repairing anything; `--force` is not a repair command.

A legitimate catalog update during readiness can change the baseline count and
cause a conservative code rollback. Coordinate catalog writers with deployment;
inspect the current catalog and retry after reconciliation. This check never
authorizes restoring the database. A dependency outage can also keep the prior
application unhealthy; rollback cannot repair that dependency.

Automatic crash recovery applies to durable phase boundaries where command
completion is known. An interrupted writer command can leave a durable in-flight
record and requires inspection even if a guardian later stopped it. The tool
does not kill processes using persisted PIDs, automatically erase ambiguous
command records, or provide a `--force` bypass. An interruption **inside**
`git reset` can also leave dirty tracked files or an ambiguous Git lock; the tool
does not delete `index.lock` or overwrite unknown source changes. Interrupted
deployments after a known-completed reset, including partial runtime-artifact
replacement, can use the verified snapshot automatically. If the service is unexpectedly active in
`switching` or `restoring` (for example after a host reboot or manual restart),
recovery stops before discarding potentially fresh media. Inspect and preserve
those files before any manual restore. The service is not gated on pending state
at boot, and the deployer is not a continuous health monitor after a committed
release.

## Test prerequisites

Run the complete suite on Linux with `flock` and Python 3 available. The process
tests use Python's standard-library `fcntl` to exercise actual kernel locks. On
Linux, the suite explicitly fails if Python 3 or `fcntl` is unavailable; it does
not silently skip that prerequisite. The Linux-prerequisite assertion skips on
macOS by platform, which does not establish full Linux recovery validation.
Python is a test-only requirement: the installed host deployer uses Node built-ins
and Git, GNU `cp`, `flock` and `systemctl`, and does not require Python. Disposable
tests must not use production credentials or the production application's
directories or service.

Tests of staged failures and crash recovery do not establish that host recovery
has been exercised. Before claiming production recovery, record a reviewed host
installation, successful normal deployment, and an isolated recovery rehearsal
with manual-media preservation. Keep the existing recovery route available until
those checks pass.
