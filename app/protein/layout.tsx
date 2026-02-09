import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "프로틴 추천 & 가격 참고",
  description:
    "WPC, WPI, 게이너 등 인기 프로틴 보충제 추천 목록. 쿠팡, 네이버 최저가 비교.",
  openGraph: {
    title: "프로틴 추천 | GymTools",
    description:
      "인기 프로틴 보충제 가격 참고 & 추천 목록.",
  },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
