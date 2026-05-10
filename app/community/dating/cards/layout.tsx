import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "오픈카드 소개팅",
  description:
    "운동하는 사람들의 오픈카드를 보고 바로 지원해보세요. 빠른매칭, 가까운 이상형 보기, 1:1 소개팅까지 짐툴에서 자연스럽게 연결됩니다.",
  openGraph: {
    title: "오픈카드 소개팅 | 짐툴 GymTools",
    description: "지역, 운동 스타일, 가치관을 보고 마음에 드는 오픈카드에 바로 지원하는 소개팅 서비스입니다.",
  },
};

export default function DatingCardsLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
