import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "1RM 계산기",
  description: "중량과 반복 횟수를 입력해 벤치프레스·스쿼트·데드리프트 예상 1RM과 추천 작업 중량을 계산하세요.",
  alternates: { canonical: "/1rm" },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}

