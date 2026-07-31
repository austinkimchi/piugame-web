export const siteName = "MyPIU";
export const siteDescription =
  "Browse Pump It Up Phoenix 2 songs, charts, folders, previews, and version history in a searchable community catalog.";
export const sitePreviewImage = {
  path: "/embed_image.png",
  width: 1239,
  height: 756,
  alt: "MyPIU Pump It Up song catalog preview",
  type: "image/png",
};
const productionSiteUrl = "https://mypiu.austin.kim";

export function getSiteUrl(): URL {
  const rawUrl = process.env.NEXT_PUBLIC_SITE_URL ?? process.env.VERCEL_PROJECT_PRODUCTION_URL ?? productionSiteUrl;
  const normalizedUrl = rawUrl.startsWith("http") ? rawUrl : `https://${rawUrl}`;

  return new URL(normalizedUrl);
}

export function absoluteSiteUrl(pathname = "/"): string {
  return new URL(pathname, getSiteUrl()).toString();
}
