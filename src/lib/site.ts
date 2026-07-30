export const siteName = "MyPIU";
export const siteDescription =
  "Browse Pump It Up Phoenix 2 songs, charts, folders, previews, and version history in a searchable community catalog.";

export function getSiteUrl(): URL {
  const rawUrl = process.env.NEXT_PUBLIC_SITE_URL ?? process.env.VERCEL_PROJECT_PRODUCTION_URL ?? "http://localhost:3000";
  const normalizedUrl = rawUrl.startsWith("http") ? rawUrl : `https://${rawUrl}`;

  return new URL(normalizedUrl);
}

export function absoluteSiteUrl(pathname = "/"): string {
  return new URL(pathname, getSiteUrl()).toString();
}
