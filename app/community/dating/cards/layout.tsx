import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "오픈카드 소개팅 - 둘러보고 바로 지원",
  description:
    "짐툴 오픈카드에서 프로필과 소개글을 보고 바로 지원하거나, 빠른매칭과 1:1 소개팅으로 자연스럽게 연결됩니다.",
  keywords: ["오픈카드 소개팅", "짐툴 소개팅", "소개팅", "빠른매칭", "1:1 소개팅", "동네 소개팅"],
  alternates: {
    canonical: "https://helchang.com/community/dating/cards",
  },
  openGraph: {
    title: "오픈카드 소개팅 | 짐툴 GymTools",
    description: "지역, 분위기, 소개글을 보고 마음에 드는 오픈카드에 바로 지원하는 소개팅 서비스입니다.",
    url: "https://helchang.com/community/dating/cards",
    siteName: "짐툴 GymTools",
    locale: "ko_KR",
    type: "website",
  },
  twitter: {
    card: "summary",
    title: "오픈카드 소개팅 | 짐툴 GymTools",
    description:
      "짐툴 오픈카드에서 프로필과 소개글을 보고 바로 지원하거나, 빠른매칭과 1:1 소개팅으로 자연스럽게 연결됩니다.",
  },
};

export default function DatingCardsLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
