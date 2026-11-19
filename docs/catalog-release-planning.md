# Catalog release planning

`scripts/catalog-release-plan.mjs` produces a reviewable JSON plan from exported
collections. It does not connect to MongoDB or write data. Merging these files
publishes jackets but does not import songs into the database.

Run from the repository root with Node 22 or newer:

```sh
node --test test/catalog-release-plan.test.mjs
node scripts/catalog-release-plan.mjs \
  scripts/releases/phoenix2-v1.02.0.json \
  /secure/backup/catalog.ejson \
  /secure/backup/song_catalog_2.ejson \
  2026-11-19 > /secure/backup/release-plan.json
```

Each export must be JSON with a `documents` array containing every document in
that collection, including BSON Extended JSON IDs. Keep backups and plans outside
Git. Preserve BSON types when a separately reviewed writer eventually consumes
the plan. A plan is a snapshot: re-export and re-plan before any application.

The planner inserts missing songs and adds only explicitly requested chart
changes. It preserves existing IDs, manual previews, tags, chart links, history,
and version-specific metadata. An existing release row with missing chart tokens
blocks review instead of being replaced. `readyForReview` means the plan has no
known blockers; it is not permission to apply it.

For the October 15, 2026 release, the reviewed baseline proposes 21 inserts in
each of `catalog` and `song_catalog_2`, plus one `catalog.chartHistory` update for
Hello William D20. No existing difficulty changes. All new songs use the existing
`Phoenix 2` series spelling; the 15 R!SE additions use `R!se Volume 1`, explicit
unknown BPMs, and Steam Link availability tags/history. Audio stays null until
the user supplies or verifies precisely aligned preview clips.

Evidence is in `scripts/releases/phoenix2-v1.02.0-evidence.json`: official request
parameters, 97 page checksums, row offsets, and SHA-256 checksums for 21 original
700×393 PNG jackets. The November popularity feed yielded 169 charts; the release
notice supplies two additional cooperative charts. Exhausting a popularity feed
does not prove that unplayed charts are absent. No Basic-mode inventory was
requested, so `chartsBasic: []` represents no collected evidence. The November
24 release is deliberately excluded while its general release is still future.

Before writing, review the exact plan, verify deployed jackets and backup hashes,
and use compare-before-write checks plus a durable recovery journal. The current
MongoDB server is standalone: do not assume multi-document transactions or apply
the plan through an unordered bulk overwrite. Stop on a concurrent edit and
reconcile it explicitly. Re-running the planner against the fully applied result
must produce no changes.
