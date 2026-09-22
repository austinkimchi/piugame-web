# Recommendation MVP

This first stage deliberately uses an explainable hybrid ranker rather than a trained black-box model. The current community dataset is still sparse, so a learned collaborative model would have a severe cold-start problem.

## Research basis

- [Tillerino's recommendation documentation](https://github.com/Tillerino/Tillerinobot/wiki/Recommendations) describes model generations that use player performance and difficulty rather than popularity alone, with explicit user filters instead of a fully opaque feed.
- [Tillerino's open-source recommendation manager](https://github.com/Tillerino/Tillerinobot/blob/master/tillerinobot/src/main/java/tillerino/tillerinobot/recommendations/RecommendationsManager.java) builds from top plays, excludes played and recently recommended maps, keeps the strongest candidate pool, and samples by model probability.
- The [osu! recommendation design discussion](https://github.com/ppy/osu/discussions/32525) argues for explainable performance and difficulty inputs, user control, and some exploration so popularity does not collapse the feed into the same few maps.
- The [osu! default-difficulty discussion](https://github.com/ppy/osu/discussions/21985) records a failure mode directly relevant here: top scores alone can lag behind what a player currently prefers, so the recommendation should remain tunable and should not equate one exceptional clear with a comfort level.

## Stage 1

Chart selection and discovery use separate decisions:

1. Clicking a known song prefers a play from the last 24 hours, then the hardest chart the player has passed on that song, then the latest attempt.
2. An unplayed song uses the 70th percentile of score-adjusted performance levels for that mode. A 950,000 score is neutral evidence at the chart's level; lower scores reduce the inferred comfort level by up to two levels, while exceptional scores can add at most 0.75. This keeps a barely cleared S19 from outweighing a broad S16-S18 history.
3. The `recommendation` feed excludes songs the player has already attempted and scores each remaining chart with:
   - 58% difficulty fit around the demonstrated level.
   - 25% Bayesian-smoothed population clear rate.
   - 15% logarithmic population popularity.
   - 2% stable per-player exploration to break sparse-data ties without changing during pagination.
4. The full supported catalog supplies cold-start candidates. Population evidence enriches those candidates when it exists.
5. PIUGAME and catalog song titles are normalized for Unicode width, whitespace, and case before evidence is joined. Known-song history is loaded from the complete per-version user evidence set so title variants cannot silently force a generic fallback.

## Later stages

- Record recommendation impressions, opens, dismissals, and clears so offline evaluation can measure usefulness instead of clicks alone.
- Add recent recommendation exclusion and controlled weighted sampling for more variety.
- Incorporate chart tags and pattern preferences once tag coverage is reliable.
- Evaluate pass rate, level error, catalog coverage, repetition, and post-recommendation play outcomes before training a collaborative or learning-to-rank model.
- Add explicit player controls for comfortable, stretch, and discovery modes before personalizing more aggressively.
