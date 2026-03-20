import type { Metadata } from "next";
import AdInquiryPageContent from "@/components/AdInquiryPageContent";

export const metadata: Metadata = {
  title: "광고 문의 | 짐툴 GymTools",
  description: "짐툴 배너, 제휴, 스폰서 광고 문의를 위한 안내 페이지입니다.",
};

export default function AdInquiryPage() {
  return <AdInquiryPageContent />;
}
