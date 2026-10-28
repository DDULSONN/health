import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { FRIEND_TOKEN } from "@/lib/friend-recommendation";
import FriendRecommendationPage from "@/components/dating/sharing/FriendRecommendationPage";
export const metadata: Metadata = { title: "친구가 추천한 프로필 | 짐툴", description: "친구가 추천한 프로필을 짐툴에서 확인해 보세요.", robots: { index: false, follow: false, nocache: true }, referrer: "no-referrer", openGraph: { title: "친구가 추천한 프로필 | 짐툴", description: "프로필은 가입·휴대폰 인증 후 확인할 수 있어요." } };
export default async function Page({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params; if (!FRIEND_TOKEN.test(token)) notFound();
  return <FriendRecommendationPage token={token} />;
}
