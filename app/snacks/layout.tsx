import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "다이어트 간식 추천 - 프로틴바·프로틴·간식 랭킹",
  description:
    "헬창 주인장이 직접 먹어보고 고른 프로틴바, 프로틴, 다이어트 간식 맛있는 순 랭킹.",
  openGraph: {
    title: "다이어트 간식 추천 | GymTools",
    description: "프로틴바·프로틴·다이어트 간식 맛있는 순 랭킹.",
  },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
