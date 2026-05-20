import type { Metadata, Viewport } from "next";
import dynamic from "next/dynamic";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import MobileBottomTabBar from "@/components/MobileBottomTabBar";
import SiteGuideBubble from "@/components/SiteGuideBubble";

const DeferredAdSenseBootstrap = dynamic(() => import("@/components/AdSenseBootstrap"), {});

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const siteTitle = "짐툴 GymTools - 운동하는 사람들의 소개팅";
const siteDescription =
  "짐툴은 오픈카드, 빠른매칭, 1:1 소개팅으로 운동하는 사람들이 더 자연스럽게 연결되는 소개팅 서비스입니다.";

export const metadata: Metadata = {
  title: {
    default: siteTitle,
    template: "%s | 짐툴 GymTools",
  },
  description: siteDescription,
  applicationName: "짐툴",
  manifest: "/manifest.webmanifest",
  keywords: ["짐툴", "GymTools", "운동 소개팅", "헬스 소개팅", "오픈카드", "빠른매칭", "1:1 소개팅"],
  icons: {
    shortcut: "/favicon.ico",
    apple: "/apple-touch-icon.png",
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/favicon-16x16.png", sizes: "16x16", type: "image/png" },
      { url: "/favicon-32x32.png", sizes: "32x32", type: "image/png" },
      { url: "/favicon-48x48.png", sizes: "48x48", type: "image/png" },
      { url: "/icon-192x192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512x512.png", sizes: "512x512", type: "image/png" },
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "GymTools",
  },
  openGraph: {
    title: siteTitle,
    description: "오픈카드로 바로 지원하고, 빠른매칭과 1:1 소개팅으로 운동 취향이 맞는 사람을 만나보세요.",
    siteName: "짐툴 GymTools",
    type: "website",
    locale: "ko_KR",
  },
  twitter: {
    card: "summary",
    title: siteTitle,
    description: "오픈카드, 빠른매칭, 1:1 소개팅으로 운동하는 사람들과 자연스럽게 연결돼요.",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0f172a",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: "짐툴 GymTools",
    alternateName: ["GymTools", "짐툴", "운동 소개팅"],
    description: siteDescription,
    url: "https://helchang.com",
  };

  return (
    <html lang="ko">
      <head>
        <meta charSet="utf-8" />
        <meta name="theme-color" content="#0f172a" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="default" />
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      </head>
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased flex flex-col min-h-dvh`}>
        <DeferredAdSenseBootstrap />
        <Header />
        <SiteGuideBubble />
        <div className="flex-1 pb-20 md:pb-0">{children}</div>
        <MobileBottomTabBar />
        <Footer />
      </body>
    </html>
  );
}
