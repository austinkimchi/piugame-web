import { absoluteSiteUrl, getSiteUrl, siteDescription } from "@/lib/site";

export const dynamic = "force-static";

export function GET() {
  const lines = [
    "# MyPIU",
    `# ${siteDescription}`,
    "",
    "User-agent: Googlebot",
    "Allow: /$",
    "Allow: /songs/",
    "Disallow: /",
    "",
    "User-agent: *",
    "Disallow: /",
    "",
    `Sitemap: ${absoluteSiteUrl("/sitemap.xml")}`,
    `Host: ${getSiteUrl().origin}`,
    "",
  ];

  return new Response(lines.join("\n"), {
    headers: {
      "content-type": "text/plain; charset=utf-8",
    },
  });
}
