# Recommendation MVP

This first stage deliberately uses an explainable hybrid ranker rather than a trained black-box model. The current community dataset is still sparse, so a learned collaborative model would have a severe cold-start problem.

## Research basis

- [Tillerino's recommendation documentation](https://github.com/Tillerino/Tillerinobot/wiki/Recommendations) describes model generations that use player performance and difficulty rather than popularity alone.
- [Tillerino's open-source recommendation manager](https://github.com/Tillerino/Tillerinobot/blob/master/tillerinobot/src/main/java/tillerino/tillerinobot/recommendations/RecommendationsManager.java) builds from top plays, excludes already played or recently recommended maps, ranks a candidate pool, and samples from the strongest candidates.
- The [osu! recommendation design discussion](https://github.com/ppy/osu/discussions/32525) highlights two useful constraints for an MVP: keep ranking explainable and preserve some exploration so popularity does not collapse the feed into the same few maps.

## Stage 1

Chart selection and discovery use separate decisions:

1. Clicking a known song prefers a play from the last 24 hours, then the hardest chart the player has passed on that song, then the latest attempt.
2. An unplayed song uses the 70th percentile of the player's passed chart levels for that mode. This represents a normal upper range without treating a few hardest clears as the player's default level.
3. The `recommendation` feed excludes songs the player has already attempted and scores each remaining chart with:
   - 58% difficulty fit around the demonstrated level.
   - 25% Bayesian-smoothed population clear rate.
   - 15% logarithmic population popularity.
   - 2% stable per-player exploration to break sparse-data ties without changing during pagination.
4. The full supported catalog supplies cold-start candidates. Population evidence enriches those candidates when it exists.

## Later stages

- Record recommendation impressions, opens, dismissals, and clears so offline evaluation can measure usefulness instead of clicks alone.
- Add recent recommendation exclusion and controlled weighted sampling for more variety.
- Incorporate chart tags and pattern preferences once tag coverage is reliable.
- Evaluate pass rate, level error, catalog coverage, repetition, and post-recommendation play outcomes before training a collaborative or learning-to-rank model.
- Add explicit player controls for comfortable, stretch, and discovery modes before personalizing more aggressively.
