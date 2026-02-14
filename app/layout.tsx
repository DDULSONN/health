import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import Header from "@/components/Header";
import Footer from "@/components/Footer";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "짐툴 (GymTools) - 헬스 계산기 & 몸평 커뮤니티",
    template: "%s | 짐툴 GymTools",
  },
  description:
    "짐툴은 1RM 계산기, 3대 합계 계산기, 헬창 판독기와 몸평 커뮤니티를 제공하는 헬스 플랫폼입니다.",
  applicationName: "짐툴",
  openGraph: {
    title: "짐툴 (GymTools) - 헬스 계산기 & 몸평 커뮤니티",
    description:
      "짐툴은 1RM 계산기, 3대 합계 계산기, 헬창 판독기와 몸평 커뮤니티를 제공하는 헬스 플랫폼입니다.",
    siteName: "짐툴 GymTools",
    type: "website",
    locale: "ko_KR",
  },
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
    alternateName: ["GymTools", "짐툴"],
    url: "https://helchang.com",
  };

  return (
    <html lang="ko">
      <head>
        <meta charSet="utf-8" />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased flex flex-col min-h-dvh`}
      >
        <Header />
        <div className="flex-1">{children}</div>
        <Footer />
      </body>
    </html>
  );
}

