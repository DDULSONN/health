import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "커뮤니티 | 짐툴 GymTools",
  description: "운동 기록, 자유글, 사진 몸평을 한 번에 보는 짐툴 커뮤니티입니다.",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
