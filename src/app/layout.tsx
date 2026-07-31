import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

import { SiteFooter } from "@/components/site-footer";
import { getCurrentUser, isAdmin } from "@/lib/auth";
import { absoluteSiteUrl, getSiteUrl, siteDescription, siteName, sitePreviewImage } from "@/lib/site";

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
  icons: {
    icon: [
      { url: "/favicon-light.ico", media: "(prefers-color-scheme: light)", sizes: "any" },
      { url: "/favicon.ico", media: "(prefers-color-scheme: dark)", sizes: "any" },
      { url: "/icon", type: "image/png", sizes: "64x64" },
    ],
    apple: [
      { url: "/apple-icon-light.png", media: "(prefers-color-scheme: light)", sizes: "180x180", type: "image/png" },
      { url: "/apple-icon", media: "(prefers-color-scheme: dark)", sizes: "180x180", type: "image/png" },
    ],
  },
  openGraph: {
    title: `${siteName} | Pump It Up Song Catalog`,
    description: siteDescription,
    url: "/",
    siteName,
    images: [
      {
        url: absoluteSiteUrl(sitePreviewImage.path),
        width: sitePreviewImage.width,
        height: sitePreviewImage.height,
        alt: sitePreviewImage.alt,
        type: sitePreviewImage.type,
      },
    ],
    locale: "en_US",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: `${siteName} | Pump It Up Song Catalog`,
    description: siteDescription,
    images: {
      url: absoluteSiteUrl(sitePreviewImage.path),
      alt: sitePreviewImage.alt,
    },
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
