import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "3대 합계 계산기",
  description: "스쿼트·벤치프레스·데드리프트 기록을 합산하고 현재 3대 운동 수준을 확인하세요.",
  alternates: { canonical: "/lifts" },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}

