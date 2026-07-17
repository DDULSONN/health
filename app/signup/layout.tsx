import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "회원가입",
  description: "Google, Apple 또는 이메일로 짐툴에 가입하고 소개팅을 시작하세요.",
  robots: {
    index: false,
    follow: false,
  },
};

export default function SignupLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
