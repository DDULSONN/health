import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "운동 클래스 관리",
  robots: {
    index: false,
    follow: false,
  },
};

export default function CommunityClassesLayout({ children }: { children: ReactNode }) {
  return children;
}
