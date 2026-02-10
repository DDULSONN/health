import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "커뮤니티",
  description: "GymTools 사용자들의 운동 기록과 랭킹을 확인하세요.",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
