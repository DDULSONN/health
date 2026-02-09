import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "1RM 계산기 - Epley/Brzycki 추정",
  description:
    "사용 중량과 반복 횟수로 1RM(1회 최대 중량)을 추정합니다. Epley, Brzycki 공식 지원. 퍼센트별 작업 중량표 제공.",
  openGraph: {
    title: "1RM 계산기 | GymTools",
    description:
      "중량과 반복 횟수로 1RM을 추정하고, 퍼센트별 작업 중량표까지.",
  },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
