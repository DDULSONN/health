import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "다이어트 간식 & 프로틴 추천",
  description:
    "프로틴바 맛있는 순 랭킹, 프로틴 보충제 가격 비교. 다이어트 간식 추천 모음.",
  openGraph: {
    title: "다이어트 간식 | GymTools",
    description: "프로틴바 랭킹, 프로틴 보충제 추천 & 가격 비교.",
  },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
