# Official game UI assets

`public/assets/piu/ui/manifest.json` is the provenance inventory for 294 verified PNGs (8,636,240 bytes). Each record includes the official source URL, local category/path, byte count, SHA-256, dimensions and discovery evidence. The seven-file November 19 addendum comes from exact references in the legacy official Top Steps Basic/Full pages; all original 287 asset bytes are unchanged. The original downloadable collection and the small addendum are retained separately on the maintenance laptop.

## Coverage and limits

Both Phoenix versions include 16 normal grades, 16 separately named failed grades, eight full plates and eight small plates. Phoenix 2 full stepballs have the ten shared `s_num_*` digits plus Single, Double and Co-op labels/backgrounds and the Co-op icon. Current Double rendering uses the shared digits; the ten unavailable `d_num_*` probes are not broken official-page references.

Phoenix 2 Basic has four verified complete guide composites and some separate labels/backgrounds. The eight unavailable Basic digit probes were inferred legacy counterparts, not current page references. Legacy Basic digits are verified only for Easy 0/1/2, Normal 0/3/4, Hard 0/5/6/7 and Very Hard 0/9; legacy full Double digits are 0/1/7. Other combinations and a general score-number font remain unverified. Do not construct missing asset URLs or call this an exhaustive arcade extraction.

The `unavailable` manifest entries retain their original evidence and now record the later 404 check and namespace findings. New discovery should follow official HTML/CSS references, preserve existing hashes and keep unknown families explicit. These official-site assets have no separately established redistribution license; the provenance does not imply ownership or a new license grant.

## Performance attempt cards

`src/lib/performance-result-badges.ts` contains the small client allowlist, tested against the manifest. The full manifest is not imported by the badge component. Artwork follows the performance attempt's `phoenix`/`phoenix2` version, including verified intrinsic dimensions, rather than the song's catalog version.

Grades and plates are separate result fields. A missing grade displays `Played`; a plate is never substituted for a grade. Plus spellings normalize to `_p`, and `x_` selects the official failed-grade family. Stage Break suppresses both result badges and retains the existing explicit Stage Break card. Unknown values/versions never generate guessed image paths.

`src/components/performance-result-badge.tsx` reserves compact stable dimensions. Each badge exposes one descriptive accessible label; the nested image is decorative. Unknown values or image errors use text, with the complete label available to assistive technology and the title tooltip. A changed image URL resets the error fallback. Dates remain keyboard-operable and the score-link behavior is preserved.

Validation includes every recognized grade/plate mapping in both versions, rendered accessibility/text escaping, all 294 PNG hashes/dimensions/totals, and real-browser fixture checks at 320, 390, 768 and 1440 pixels. The temporary fixture route is removed before publication. This initial integration covers song-detail attempt cards only; stepballs, other views and native mobile remain separate work.
