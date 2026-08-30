import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "다이어트 간식 추천",
  description: "운동과 식단 관리 중에도 부담을 줄여 즐길 수 있는 다이어트 간식을 종류별로 확인하세요.",
  alternates: { canonical: "/snacks" },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
