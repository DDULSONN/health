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

/**
 * 사이트명 후보:
 * 1. GymTools (기본 적용) - 직관적이고 깔끔
 * 2. AlphaFit Lab - 힙하고 연구소 느낌
 * 3. 헬스메이트 - 친근한 한국어
 */
export const metadata: Metadata = {
  title: {
    default: "GymTools - 헬스 유틸 종합 사이트",
    template: "%s | GymTools",
  },
  description:
    "1RM 계산기, 3대 합계, 헬창판독기, 프로틴 추천, 몸평가까지. 헬스인을 위한 올인원 도구 모음.",
  openGraph: {
    title: "GymTools - 헬스 유틸 종합 사이트",
    description:
      "1RM 계산기, 3대 합계, 헬창판독기, 프로틴 추천, 몸평가까지. 헬스인을 위한 올인원 도구 모음.",
    type: "website",
    locale: "ko_KR",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
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
