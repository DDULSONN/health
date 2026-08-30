import type { Metadata } from "next";

export const metadata: Metadata = {
  title: { absolute: "취향이 맞는 사람을 만나는 1:1 소개팅 | 짐툴 GymTools" },
  description:
    "운동 취향과 소개글을 바탕으로 후보를 확인하고, 쌍방 수락 후 안전하게 연락처를 교환하는 짐툴 1:1 소개팅입니다.",
  alternates: { canonical: "/dating/1on1" },
  openGraph: {
    title: "취향이 맞는 사람을 만나는 1:1 소개팅 | 짐툴",
    description: "프로필 작성부터 후보 확인, 쌍방 수락과 연락처 교환까지 한 번에 진행하세요.",
    url: "/dating/1on1",
    type: "website",
  },
};

export default function DatingOneOnOneLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
