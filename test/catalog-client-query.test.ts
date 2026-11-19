import assert from "node:assert/strict";
import test from "node:test";
import { queryCatalog, type CatalogQuerySong } from "../src/lib/catalog-client-query.ts";
import { catalogFilterOptionsForSelection } from "../src/lib/catalog-filter-options.ts";

function song(slug: string, values: Partial<CatalogQuerySong> = {}): CatalogQuerySong {
  return { slug, title: slug, artist: "Artist", folder: "ORIGINAL", folderPosition: 1, series: "PHOENIX 2", tags: [], chartSummary: ["S16"], ...values };
}
const ids = (songs: CatalogQuerySong[]) => songs.map((song) => song.slug);

test("literal search includes alternate song keys and tags, without matching across field boundaries", () => {
  const songs = [song("one", { title: "Visible", songKey: "Hidden alias", tags: ["fast [mix]"], artist: "Artist" }), song("two", { title: "fast remix" })];
  assert.deepEqual(ids(queryCatalog(songs, { query: "ALIAS" }).songs), ["one"]);
  assert.deepEqual(ids(queryCatalog(songs, { query: "[mix]" }).songs), ["one"]);
  assert.deepEqual(ids(queryCatalog(songs, { query: "Visible Artist" }).songs), []);
});

test("co-op search accepts CX and spacing aliases, but does not broaden to C20", () => {
  const songs = [song("coop", { chartSummary: ["C2"] }), song("not-coop", { chartSummary: ["C20"] })];
  assert.deepEqual(ids(queryCatalog(songs, { query: " c x 2 " }).songs), ["coop"]);
});

test("level and chart filters retain Mongo AND cross-product and OR semantics", () => {
  const songs = [
    song("both", { chartSummary: ["S16", "S17", "D16", "D17"] }),
    song("split", { chartSummary: ["S16", "D17"] }),
    song("single", { chartSummary: ["S16", "S17"] }),
  ];
  assert.deepEqual(ids(queryCatalog(songs, { query: "", levels: ["16", "17"], charts: ["singles", "doubles"], levelMode: "and" }).songs), ["both"]);
  assert.equal(queryCatalog(songs, { query: "", levels: ["17"], charts: ["singles", "doubles"], levelMode: "or" }).songs.length, 3);
  assert.deepEqual(ids(queryCatalog(songs, { query: "", charts: ["singles", "doubles"], levelMode: "and" }).songs), ["split", "both"]);
});

test("co-op player counts also match level-only searches; plus excludes ordinary and co-op levels", () => {
  const songs = [song("coop", { chartSummary: ["C2"] }), song("normal", { chartSummary: ["S2"] }), song("plus", { chartSummary: ["D??"] })];
  assert.deepEqual(ids(queryCatalog(songs, { query: "", levels: ["2"], levelMode: "and", sortBy: "title", sortDirection: "asc" }).songs), ["coop", "normal"]);
  assert.deepEqual(ids(queryCatalog(songs, { query: "", levels: ["+"], levelMode: "and" }).songs), ["plus"]);
  assert.deepEqual(ids(queryCatalog(songs, { query: "", levels: ["2"], charts: ["co-op"], levelMode: "and" }).songs), ["coop"]);
});

test("uses selected chartSummary, preserving historical source identity", () => {
  const songs = [song("shared-phoenix2", { chartSummary: ["S16"] })];
  assert.equal(queryCatalog(songs, { query: "", levels: ["17"], charts: ["singles"], levelMode: "and" }).songs.length, 0);
  assert.equal(queryCatalog(songs, { query: "S16" }).songs.length, 1);
});

test("folder groups are OR, legacy series labels match, and zero results retain recovery choices", () => {
  const songs = [song("original"), song("kpop", { folder: "K-POP", series: "phoenix2" }), song("world", { folder: "WORLD MUSIC", series: "PHOENIX" })];
  const selected = { folders: ["ORIGINAL", "K-POP"], series: ["PHOENIX 2"] };
  assert.equal(queryCatalog(songs, { query: "", ...selected }).songs.length, 2);
  const catalog = queryCatalog(songs, { query: "" }).filterOptions;
  const zero = queryCatalog(songs, { query: "absent", ...selected });
  const choices = catalogFilterOptionsForSelection(zero.filterOptions, catalog, selected);
  assert.deepEqual(choices.folders, ["K-POP", "ORIGINAL", "WORLD MUSIC"]);
  assert.deepEqual(choices.series, ["PHOENIX", "PHOENIX 2"]);
});

test("sorts folders by position first and uses binary text order rather than numeric locale order", () => {
  const songs = [song("ten", { title: "Song 10", folder: "A", folderPosition: 2 }), song("two", { title: "Song 2", folder: "Z", folderPosition: 1 }), song("missing", { title: "song 1", folderPosition: null })];
  assert.deepEqual(ids(queryCatalog(songs, { query: "", sortBy: "folder", sortDirection: "asc" }).songs), ["missing", "two", "ten"]);
  assert.deepEqual(ids(queryCatalog(songs, { query: "", sortBy: "title", sortDirection: "asc" }).songs), ["ten", "two", "missing"]);
});

test("unknown series remain last in either direction and favorite-first covers the whole catalog", () => {
  const songs = [song("old", { series: "PHOENIX" }), song("new"), song("unknown", { series: "SPECIAL" })];
  assert.deepEqual(ids(queryCatalog(songs, { query: "", sortBy: "series", sortDirection: "asc" }).songs), ["old", "new", "unknown"]);
  assert.deepEqual(ids(queryCatalog(songs, { query: "", sortBy: "series", sortDirection: "desc" }).songs), ["new", "old", "unknown"]);
  const large = Array.from({ length: 675 }, (_, index) => song(`song-${index}`));
  assert.equal(queryCatalog(large, { query: "", favoriteSlugs: new Set(["song-674"]) }).songs[0].slug, "song-674");
  assert.equal(large[0].slug, "song-0", "does not mutate the snapshot");
});

test("filter options distinguish co-op counts from normal levels and order plus last", () => {
  const songs = [song("one", { chartSummary: ["C2", "C4", "S16", "D??"] })];
  assert.deepEqual(queryCatalog(songs, { query: "" }).filterOptions.levels, ["16", "+"]);
  assert.deepEqual(queryCatalog(songs, { query: "", charts: ["co-op"] }).filterOptions.levels, ["2", "4"]);
});

test("favorites-first preserves its existing locale/numeric ordering separately from ordinary Mongo ordering", () => {
  const songs = [song("ten", { title: "Song 10", folder: "A", folderPosition: 2 }), song("two", { title: "Song 2", folder: "Z", folderPosition: 1 }), song("saved", { title: "Z saved" })];
  const favorites = new Set(["saved"]);
  assert.deepEqual(ids(queryCatalog(songs, { query: "", sortBy: "title", sortDirection: "asc", favoriteSlugs: favorites }).songs), ["saved", "two", "ten"]);
  assert.deepEqual(ids(queryCatalog(songs, { query: "", sortBy: "folder", sortDirection: "asc", favoriteSlugs: favorites }).songs), ["saved", "ten", "two"]);
  assert.deepEqual(ids(queryCatalog(songs, { query: "", sortBy: "title", sortDirection: "asc", favoriteSlugs: new Set() }).songs), ["ten", "two", "saved"]);
});
