# Performance Feature Plan

Branch: `codex/feature-performance`

## MVP Goals

- Add a `/performance` page for signed-in users to inspect Pump It Up play statistics.
- Store performance data in MongoDB with query patterns that stay fast as play history grows.
- Track user profile data, Pumbility, recent plays, per-chart best scores, and upscore history.
- Add an automatic refresh path for all linked users. Premium gating is deferred, so every linked PIU account is currently eligible.
- Keep the feature ready for later MyPIU home-page integration by storing performance by song/chart token.

## Current Implementation

### Page

`src/app/performance/page.tsx`

- Server-rendered route using the app router.
- Reads the current user and performance dashboard from MongoDB.
- Shows Pumbility, PP, tracked play count, tracked chart count, average best score, upscore count, top tracked charts, and recent play snapshots.
- Includes a manual `Sync now` form for development and user-triggered refreshes.
- Handles empty states for unsigned users, unlinked PIU accounts, and missing MongoDB configuration.

### API Routes

`src/app/api/performance/sync/route.ts`

- Syncs the currently signed-in user's linked PIU account.
- Intended for manual refresh from the page.
- Uses saved encrypted PIU credentials from the existing user record.

`src/app/api/performance/sync-due/route.ts`

- Syncs a bounded batch of due users.
- Opportunistically seeds schedule rows for linked PIU users so background refresh is not dependent on visiting `/performance`.
- Intended for Vercel Cron, GitHub Actions, or any external scheduler.
- Requires `Authorization: Bearer $PERFORMANCE_SYNC_SECRET` in production.
- Allows no secret only in local development.

### Server Data Module

`src/lib/performance.ts`

- Owns performance collections, indexes, dashboard projection, and sync logic.
- Uses `@austinkimchi/piugame-sdk` with `version: "phoenix2"`.
- Fetches profile and recent plays, then persists normalized snapshots.
- Creates a performance schedule row for a user when they first visit `/performance` with a linked PIU account.

## MongoDB Collections

### `performance_profiles`

One document per app user.

Purpose:

- Stores the user's latest PIU profile snapshot.
- Stores Pumbility, PP, play count, clear progress, avatar, game ID, title, and sync status.
- Acts as the scheduler queue through `nextRefreshAt`, `syncStatus`, and `syncLeaseUntil`.

Indexes:

- `{ userId: 1 }`, unique.
- `{ nextRefreshAt: 1, syncStatus: 1, syncLeaseUntil: 1 }` for due-user scans.

### `performance_play_events`

Append-only recent-play event storage.

Purpose:

- Stores each ingested recent play independently.
- Preserves history needed to detect upscores over time.
- Keeps raw `playedAt` text when the SDK cannot parse a date.

Indexes:

- `{ userId: 1, playHash: 1 }`, unique, for idempotent ingestion.
- `{ userId: 1, playedAt: -1, ingestedAt: -1 }` for recent-play timelines.
- `{ userId: 1, chartToken: 1, playedAt: -1 }` for future song/chart drilldowns.

### `performance_chart_stats`

One aggregate document per user and chart.

Purpose:

- Stores current best score, previous best score, grade, plate, and play count.
- Makes the statistics page and future per-song performance lookups fast without scanning event history.
- Uses `chartToken` derived from song name, mode, and level until catalog-token matching is introduced.

Indexes:

- `{ userId: 1, chartToken: 1 }`, unique.
- `{ userId: 1, bestScore: -1 }` for top charts.
- `{ userId: 1, updatedAt: -1 }` for recent chart movement.

## Scheduler Design

Environment:

- `PERFORMANCE_REFRESH_MINUTES`, default `30`.
- `PERFORMANCE_SYNC_BATCH_SIZE`, default `5`.
- `PERFORMANCE_SYNC_SECRET`, required in production for `/api/performance/sync-due`.

Recommended scheduler:

- Call `POST /api/performance/sync-due` every 5 minutes.
- Use `Authorization: Bearer $PERFORMANCE_SYNC_SECRET`.
- Let MongoDB choose due users by `nextRefreshAt`.
- The route seeds a small batch of linked PIU users into `performance_profiles` before scanning due work.
- Keep the batch small because PIUGAME reloads are expensive and credentials are required.

Concurrency:

- Each due profile gets a 5-minute `syncLeaseUntil` before fetching.
- Other scheduler invocations skip leased rows.
- Successful sync clears the lease and advances `nextRefreshAt`.
- Failed sync clears the lease, records `syncError`, and advances `nextRefreshAt`.

Premium plan:

- Add `subscription.plan` or similar to user records later.
- Filter due profiles by plan when querying scheduler candidates.
- Until then, every linked user is treated as eligible.

## Data Growth Strategy

Recent-play ingestion is cheap, but event history can grow quickly for active users.

MVP approach:

- Store event history as append-only documents.
- Store dashboard-ready aggregates separately in `performance_chart_stats`.
- Keep all dashboard reads bounded by indexed queries and small limits.

Future options:

- Add monthly partitions through a `playedMonth` field if event history becomes large.
- Add retention tiers when premium status exists.
- Add backfill with `fetchAllPlays(username)` for premium users or explicit imports.
- Add catalog chart IDs so `chartToken` maps directly to song explorer chart tokens.

## Future MyPIU Integration

The future home-page integration should read from `performance_chart_stats` by:

- `userId`.
- `songName` or future catalog `songSlug`.
- `chartToken`.

Target experience:

- Show user best and latest score on song cards.
- Show per-chart movement inside song detail views.
- Highlight upscores since the previous visit.
- Group performance by token when the catalog has stable chart-token IDs.

## Next Steps

1. Add catalog-aware chart-token mapping so stats attach to exact song/chart records.
2. Add a scheduler configuration in the deployment platform.
3. Add tests around idempotent ingestion and upscore aggregation.
4. Add an admin or internal sync monitor for failures and queue depth.
5. Add premium eligibility once subscription status exists.
