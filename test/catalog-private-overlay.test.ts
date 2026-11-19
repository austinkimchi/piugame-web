import assert from "node:assert/strict";
import test from "node:test";
import { catalogCommunitySlug, catalogFavoriteSlugs, updateCatalogFavoriteSlugs } from "../src/lib/catalog-private-overlay.ts";

const catalog = [
  { slug: "legacy-artist-phoenix", version: "phoenix" as const },
  { slug: "legacy-other-artist-phoenix", version: "phoenix" as const },
  { slug: "current-artist-phoenix2", version: "phoenix2" as const },
];

test("source-version catalog aliases retain legacy favorite storage and leave the public identity untouched", () => {
  const stored = new Set(["legacy-artist-phoenix2", "unrelated-phoenix2"]);
  const favorites = catalogFavoriteSlugs(catalog, stored);
  assert.equal(favorites.has("legacy-artist-phoenix"), true);
  assert.equal(favorites.has("legacy-other-artist-phoenix"), false);
  assert.equal(favorites.has("unrelated-phoenix2"), true);
  assert.equal(stored.has("legacy-artist-phoenix"), false);
  assert.equal(catalog[0].slug, "legacy-artist-phoenix");
  assert.equal(catalogCommunitySlug(catalog[0]), "legacy-artist-phoenix2");
});

test("unsaving through either a public URL or private feed clears both display aliases", () => {
  for (const slug of ["legacy-artist-phoenix", "legacy-artist-phoenix2"]) {
    const favorites = catalogFavoriteSlugs(catalog, new Set(["legacy-artist-phoenix2", "current-artist-phoenix2"]));
    const updated = updateCatalogFavoriteSlugs(favorites, catalog, slug, false);
    assert.equal(updated.has("legacy-artist-phoenix"), false);
    assert.equal(updated.has("legacy-artist-phoenix2"), false);
    assert.equal(updated.has("current-artist-phoenix2"), true);
    assert.equal(favorites.has("legacy-artist-phoenix2"), true);
    const saved = updateCatalogFavoriteSlugs(updated, catalog, slug, true);
    assert.equal(saved.has("legacy-artist-phoenix"), true);
    assert.equal(saved.has("legacy-artist-phoenix2"), true);
  }
});

test("only exact storage identities share state, including an existing legacy collision", () => {
  const identities = [...catalog, { slug: "legacy-artist-phoenix2", version: "phoenix2" as const }];
  const favorites = catalogFavoriteSlugs(identities, new Set(["legacy-artist-phoenix2", "legacy-other-artist-phoenix2"]));
  const updated = updateCatalogFavoriteSlugs(favorites, identities, "legacy-artist-phoenix", false);
  assert.equal(updated.has("legacy-artist-phoenix"), false);
  assert.equal(updated.has("legacy-artist-phoenix2"), false);
  assert.equal(updated.has("legacy-other-artist-phoenix"), true);
  assert.equal(catalogCommunitySlug({ slug: "title-phoenix-suffix", version: "phoenix" }), "title-phoenix-suffix");
  assert.equal(catalogCommunitySlug({ slug: "title-phoenix", version: "phoenix2" }), "title-phoenix");
});
