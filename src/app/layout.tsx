import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

import { SiteFooter } from "@/components/site-footer";
import { getCurrentUser, isAdmin } from "@/lib/auth";
import { absoluteSiteUrl, getSiteUrl, siteDescription, siteName } from "@/lib/site";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: getSiteUrl(),
  applicationName: siteName,
  title: {
    default: `${siteName} | Pump It Up Song Catalog`,
    template: `%s | ${siteName}`,
  },
  description: siteDescription,
  keywords: [
    "MyPIU",
    "Pump It Up",
    "PIU",
    "Pump It Up Phoenix 2",
    "Pump It Up song catalog",
    "PIU charts",
    "dance game songs",
  ],
  alternates: {
    canonical: "/",
  },
  openGraph: {
    title: `${siteName} | Pump It Up Song Catalog`,
    description: siteDescription,
    url: "/",
    siteName,
    images: [
      {
        url: absoluteSiteUrl("/opengraph-image"),
        width: 1200,
        height: 630,
        alt: `${siteName} song catalog preview`,
      },
    ],
    locale: "en_US",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: `${siteName} | Pump It Up Song Catalog`,
    description: siteDescription,
    images: [absoluteSiteUrl("/opengraph-image")],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
      "max-video-preview": -1,
    },
  },
  category: "music",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const user = await getCurrentUser();

  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col" suppressHydrationWarning>
        {children}
        <SiteFooter showAdminDashboardLink={isAdmin(user)} />
      </body>
    </html>
  );
}
