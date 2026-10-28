import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import FriendRecommendButton from "@/components/dating/sharing/FriendRecommendButton";
import FriendRecommendationPage from "@/components/dating/sharing/FriendRecommendationPage";
import FriendShareSettings from "@/components/dating/sharing/FriendShareSettings";
import AdminFriendSharesPanel from "@/components/admin/AdminFriendSharesPanel";
import FriendRecommendationNotice from "@/components/dating/sharing/FriendRecommendationNotice";
const pathname=window.location.pathname;
const token=pathname.startsWith("/s/")?pathname.split("/")[2]:null;
// Isolated preview only: fake signed-in identity, never a production cookie.
if (pathname === "/notice") document.cookie = "fixture_role=sender; path=/; SameSite=Lax";
function Preview() {
  const [noticeOpen, setNoticeOpen] = useState(pathname === "/notice");
  return <div className="min-h-screen bg-neutral-50 font-sans"><header className="border-b border-neutral-200 bg-white px-5 py-4 text-xl font-bold">짐툴 <span className="text-xs font-normal text-neutral-400">로컬 미리보기 · 가상 데이터</span></header>{token?<FriendRecommendationPage token={token}/>:<main className="mx-auto max-w-lg space-y-4 p-4">{pathname==="/settings"?<FriendShareSettings/>:pathname==="/admin"?<AdminFriendSharesPanel/>:pathname==="/signup"?<><h1>가입 후 돌아갈 추천</h1><p>{new URLSearchParams(window.location.search).get("share_return")}</p></>:<><div className="flex items-center justify-between gap-3"><h1 className="text-lg font-semibold">친구에게 추천하고 싶은 분</h1>{pathname === "/notice" ? <button type="button" onClick={() => setNoticeOpen(true)} className="rounded-lg border border-neutral-200 bg-white px-3 py-2 text-xs text-neutral-600">공지 다시보기</button> : null}</div><div className="rounded-2xl border border-neutral-200 bg-white p-4"><h2 className="font-semibold">추천회원 · 31세 · 서울</h2><p className="mt-2 text-sm text-neutral-600">산책을 좋아해요.</p><FriendRecommendButton kind="open_card" cardId="00000000-0000-4000-8000-000000000012" label="추천회원"/></div></>}</main>}{noticeOpen ? <FriendRecommendationNotice onClose={() => setNoticeOpen(false)} onExplore={() => { window.location.assign('/'); }} onSettings={() => { window.location.assign('/settings'); }} /> : null}</div>;
}
createRoot(document.getElementById("root")!).render(<Preview />);
