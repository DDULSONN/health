import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "몸평가 - 나에게 맞는 운동 방향",
  description:
    "10문항 설문으로 벌크업/감량/유지/근성장 등 나에게 맞는 운동 방향을 진단합니다.",
  openGraph: {
    title: "몸평가 | GymTools",
    description:
      "10문항 설문으로 나에게 맞는 운동 방향 진단.",
  },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
