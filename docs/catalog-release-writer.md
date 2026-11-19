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
Only a writable standalone MongoDB server is supported. The CLI connects directly
to one server; replica sets and `mongos` are rejected during preflight. Both
collection UUIDs, the standalone topology and the database name are bound into the journal so a
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
The client and every document read explicitly disable BSON value/Long promotion,
request `BSONRegExp`, and retain Binary wrappers. This preserves small Int64 values,
integral Doubles, regex options, and Binary subtypes before EJSON serialization;
EJSON alone cannot recover types already promoted to ordinary JavaScript values.

The existing song update uses one atomic compare-and-set covering its identity,
history, Phoenix 2 availability, and chart links. An indexed `_id` predicate is
combined with aggregation `$expr` equality over complete values, protected by
`$literal`. `$type` distinguishes missing fields and explicit nulls; object-parent
checks prevent nested field paths from silently traversing arrays. Query `$eq`
alone is insufficient because it can match array elements. Only `chartHistory` is set: concurrent audio,
tags, chart-video links, folder positions, and other unrelated metadata survive.
The journal records the full observed document after the operation, including
those unrelated changes. Inserts use reserved IDs and the existing unique song
identity index. The writer cannot apply the 43 operations as one transaction on
the standalone server; a failure can leave a partially applied release.

On interruption, inspect the existing journal and resume with the **same exact
plan, hash, database, and journal path** plus `--resume`. Never create a new journal
to retry a partially applied release. Do not edit the journal or delete its lock
file. The writer retains the locked open file description itself. A short-lived
`flock` utility acquires the lock through an inherited descriptor and exits before
the write callback starts, so helper death cannot silently unlock active writes.
The kernel releases the lock when the owning writer closes its descriptor or
dies; the persistent lock file itself is harmless.

```sh
node scripts/catalog-release-write.mjs --plan /secure/catalog-release-plan.json \
  --apply --resume --reviewed-sha256 REVIEWED_64_CHARACTER_HASH \
  --database piugame_sdk --journal /secure/october-release-journal.ejson
```

Resume preflights every operation again. A readable prepared result does **not**
prove a lost write acknowledgement was durable. When the reserved ID and planned
after fields match, recovery runs the admin command `{ fsync: 1, lock: false }`
using the credential's existing privilege, then rechecks the same standalone
target, collection UUIDs, and exact after state. Only a successful barrier and
matching reread allow a durable recovered record without repeating the write.
The journal includes the barrier evidence. A denied or failed barrier leaves the
operation prepared and stops; the writer never grants privileges or falls back
to a normal read or standalone `readConcern: majority` as a durability substitute.
Read-only preflight never runs `fsync`. Version 2 journals require this evidence;
the writer refuses old version 1 journals rather than trusting old recovery marks.

MongoDB documents [`fsync`](https://www.mongodb.com/docs/v5.0/reference/command/fsync/)
as flushing pending storage writes to disk; `lock: false` avoids a persistent
server write lock. This barrier adds I/O and needs the existing `fsync` privilege.
It does not serialize other clients' writes. Concurrent external edits, including
an after→other→after (ABA) sequence during the barrier, remain outside a serializable
guarantee, as with concurrent edits following an ordinary acknowledged write.
The writer adds no global write lock, revision field, or auxiliary collection.

A pending operation never claims an already-present row as its own. A
different ID, missing completed row, altered relevant fields, changed plan, or
replacement collection stops the run. A prepared update that matches neither
its exact before state nor its exact after state is ambiguous and stops. Even a
curated edit to a field initialized by an inserted row causes a conservative
stop; it is never overwritten to force the plan through. Additional fields not
part of an inserted payload are preserved. Review conflicts manually against
the journal and backups; there is no automatic rollback or journal reset.

The tests inject a fake MongoDB implementation and use temporary local journals.
They cover partial failures, both crash-after-write windows, BSON wire decoding,
missing-versus-null CAS, relevant and unrelated concurrent edits, collisions,
collection replacement, duplicate writers, and process-death lock recovery.
No test connects to production or assumes multi-document transactions.

The writer's lock tests require **Linux and `flock`**, including when invoked by
the full `npm test` suite. They fail on a Mac without that Linux facility; passing
non-lock tests there is not full writer validation. Run the complete suite in
Linux CI or a disposable Linux environment. This is an intentional runtime
dependency, not a reason to bypass locking in the writer.

An optional real-server CAS check is in
`test/catalog-release-write.integration.test.mjs`. It is skipped by default and
never starts or downloads a server. Supply a disposable MongoDB **5.0.8** standalone
on an ephemeral loopback port (the normal port 27017 is refused), with no host data
mounts. The test creates and drops only its uniquely named scratch database.

```sh
CATALOG_WRITER_RUN_MONGO_INTEGRATION=1 \
CATALOG_WRITER_TEST_MONGODB_URI=mongodb://127.0.0.1:EPHEMERAL_PORT \
node --test test/catalog-release-write.integration.test.mjs
```

Remove only the dedicated test container and its temporary image afterward;
never stop or delete another MongoDB service or reuse application credentials.
