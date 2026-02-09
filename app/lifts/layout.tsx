import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "3대 합계 계산기",
  description:
    "스쿼트, 벤치프레스, 데드리프트 합계와 체중 대비 비율 등급을 확인하세요.",
  openGraph: {
    title: "3대 합계 계산기 | GymTools",
    description:
      "스쿼트/벤치/데드 합계와 체중 대비 등급 확인.",
  },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
