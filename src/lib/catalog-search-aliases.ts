interface CatalogTitleAliasTarget {
  title: RegExp;
  artist: RegExp;
}

// These aliases affect discovery only. Published titles and stored identities
// remain unchanged. Both primary sources spell this title "Becouse of You":
// https://www.youtube.com/watch?v=3zxlreV_NH8
// https://tanoc.bandcamp.com/track/becouse-of-you
const TITLE_ALIASES = [{
  title: /^\s*Becouse\s+of\s+You\s*$/i,
  artist: /^\s*Srav3R\s+&\s+USAO\s*$/i,
  aliases: ["because of you"],
}];

// Use the same literal substring semantics as ordinary catalog search, then
// constrain any added match to its exact title AND artist in every consumer.
export function catalogTitleAliasTargets(query: string): readonly CatalogTitleAliasTarget[] {
  const normalized = query.replace(/\s+/g, " ").trim().toLowerCase();
  return normalized
    ? TITLE_ALIASES.filter(({ aliases }) => aliases.some((alias) => alias.includes(normalized)))
    : [];
}
