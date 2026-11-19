# October catalog writer

`scripts/catalog-release-write.mjs` applies only the October PHOENIX 2 plan:
42 exact inserts from the committed manifest and one appended Hello William D20
history event. It rejects other collections, metadata changes, extra operations,
and altered new-song payloads. It does not deploy jackets or generate previews.

The default command validates the plan and prints its SHA-256 without contacting
MongoDB. Plans, backup exports, and journals stay outside Git.

```sh
node scripts/catalog-release-write.mjs --plan /secure/catalog-release-plan.json
node --test test/catalog-release-plan.test.mjs test/catalog-release-write.test.mjs
```

An optional database preflight reads the target without writing a journal or any
database records. Supply the connection using `CATALOG_RELEASE_MONGODB_URI` in the
process environment; application `.env` files are never loaded. Do not put the URI
in command arguments or logs. The database name must be explicit.

```sh
node scripts/catalog-release-write.mjs --plan /secure/catalog-release-plan.json \
  --preflight --database piugame_sdk
```

Before an approved application, re-export and review the exact plan and deployed
jackets. The target must already have a non-partial, non-sparse unique compound
index on `songKey` and `artist` in both collections, with simple collation. The
writer never creates indexes. Missing indexes require separate review before use.
Both collection UUIDs and the database name are bound into the journal so a
resume cannot silently target replacement collections.

Application is opt-in and requires the exact reviewed plan byte hash and an
absolute journal path outside the checkout. The journal's parent directory must
already exist. Use Linux with the installed `flock` utility and a local filesystem
that honors `fsync` and atomic rename. Keep the journal, its lock file, and any
interrupted temporary journal files together until the release is reconciled.

```sh
node scripts/catalog-release-write.mjs --plan /secure/catalog-release-plan.json \
  --apply --reviewed-sha256 REVIEWED_64_CHARACTER_HASH \
  --database piugame_sdk --journal /secure/october-release-journal.ejson
```

All operations preflight before the first database write. Generated BSON
ObjectIds, the plan hash, target identity, full before/expected-after documents,
and relevant field-presence states are durably saved first. Every write then gets
a durable intent record, an individual acknowledged MongoDB operation with
`w: majority, j: true`, an after-state check, and a durable result record. Each
journal save writes a private temporary file, fsyncs it, atomically renames it,
and fsyncs the parent directory. BSON EJSON retains ObjectIds and other BSON types.

The existing song update uses one atomic compare-and-set covering its identity,
history, Phoenix 2 availability, and chart links. Missing fields and explicit
nulls have different predicates. Only `chartHistory` is set: concurrent audio,
tags, chart-video links, folder positions, and other unrelated metadata survive.
The journal records the full observed document after the operation, including
those unrelated changes. Inserts use reserved IDs and the existing unique song
identity index. The writer cannot apply the 43 operations as one transaction on
the standalone server; a failure can leave a partially applied release.

On interruption, inspect the existing journal and resume with the **same exact
plan, hash, database, and journal path** plus `--resume`. Never create a new journal
to retry a partially applied release. Do not edit the journal or delete its lock
file. The kernel lock is released automatically when the owning process dies;
the persistent lock file itself is harmless.

```sh
node scripts/catalog-release-write.mjs --plan /secure/catalog-release-plan.json \
  --apply --resume --reviewed-sha256 REVIEWED_64_CHARACTER_HASH \
  --database piugame_sdk --journal /secure/october-release-journal.ejson
```

Resume preflights every operation again. A prepared operation whose reserved ID
and planned after fields match is recorded as recovered without repeating the
write. A pending operation never claims an already-present row as its own. A
different ID, missing completed row, altered relevant fields, changed plan, or
replacement collection stops the run. A prepared update that matches neither
its exact before state nor its exact after state is ambiguous and stops. Even a
curated edit to a field initialized by an inserted row causes a conservative
stop; it is never overwritten to force the plan through. Additional fields not
part of an inserted payload are preserved. Review conflicts manually against
the journal and backups; there is no automatic rollback or journal reset.

The tests inject a fake MongoDB implementation and use temporary local journals.
They cover partial failures, both crash-after-write windows, BSON identities,
missing-versus-null CAS, relevant and unrelated concurrent edits, collisions,
collection replacement, duplicate writers, and process-death lock recovery.
No test connects to production or assumes multi-document transactions.
