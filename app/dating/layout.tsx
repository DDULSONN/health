import type { Metadata } from "next";

const title = "짐툴 소개팅 - 오픈카드·빠른매칭·1:1 매칭";
const description =
  "짐툴에서 오픈카드, 빠른매칭, 1:1 소개팅으로 원하는 방식의 만남을 시작해보세요. 지역, 분위기, 소개글을 보고 자연스럽게 연결됩니다.";

export const metadata: Metadata = {
  title,
  description,
  keywords: [
    "짐툴 소개팅",
    "소개팅",
    "오픈카드 소개팅",
    "빠른매칭",
    "1:1 소개팅",
    "동네 소개팅",
    "랜덤 소개팅",
    "소개팅 사이트",
  ],
  alternates: {
    canonical: "https://helchang.com/dating",
  },
  openGraph: {
    title: `${title} | GymTools`,
    description,
    url: "https://helchang.com/dating",
    siteName: "짐툴 GymTools",
    locale: "ko_KR",
    type: "website",
  },
  twitter: {
    card: "summary",
    title,
    description,
  },
};

export default function DatingLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
