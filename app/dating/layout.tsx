import type { Metadata } from "next";

const title = "짐툴 소개팅 - 오픈카드와 1:1 소개팅으로 부담 없이 시작";
const description =
  "짐툴은 오픈카드와 1:1 소개팅으로 부담 없이 둘러보고 자연스럽게 연결되는 소개팅 서비스입니다. 다양한 후보를 확인하고 번호 공개 전까지 개인정보를 보호하며 만남을 시작해보세요.";

export const metadata: Metadata = {
  title,
  description,
  keywords: [
    "짐툴 소개팅",
    "소개팅",
    "소개팅 앱",
    "소개팅 사이트",
    "운동 소개팅",
    "헬스 소개팅",
    "오픈카드 소개팅",
    "1:1 소개팅",
    "동네 소개팅",
    "직장인 소개팅",
  ],
  alternates: {
    canonical: "https://helchang.com/dating",
  },
  openGraph: {
    title: `${title} | GymTools`,
    description,
    url: "https://helchang.com/dating",
    siteName: "짐툴 GymTools",
    locale: "ko_KR",
    type: "website",
  },
  twitter: {
    card: "summary",
    title,
    description,
  },
};

export default function DatingLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
