import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "헬스 계산기와 운동 도구",
  description: "1RM 계산기, 3대 합계 계산기, 플러팅 문구 등 운동하는 사람을 위한 짐툴 도구를 모았습니다.",
  alternates: { canonical: "/tools" },
};

export default function ToolsLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
