import React from "react";
import { createRoot } from "react-dom/client";
import ReturnProfileRewardBanner from "../../components/ReturnProfileRewardBanner";
import { fixtureAuth, fixturePath } from "./return-reward-adapters";
declare global { interface Window { rewardFixture: { auth: typeof fixtureAuth; path: typeof fixturePath } } }
window.rewardFixture = { auth: fixtureAuth, path: fixturePath };
if (new URLSearchParams(location.search).get("preview") === "anonymous") fixtureAuth(null);
createRoot(document.getElementById("root")!).render(<React.StrictMode>
  <header className="border-b border-gray-100 bg-white px-5 py-5 text-xl font-bold">짐툴</header>
  <ReturnProfileRewardBanner />
  <main className="mx-auto max-w-5xl px-4 py-6">
    <div className="flex gap-4 text-sm font-semibold"><span className="text-rose-600">오픈카드</span><span className="text-gray-500">1:1 매칭</span></div>
    <div className="mt-5 rounded-2xl border border-gray-200 bg-white p-5"><h1 className="font-semibold">마음에 드는 프로필을 찾아보세요</h1><p className="mt-2 text-sm leading-6 text-gray-500">이 화면은 복귀 안내 배너를 확인하기 위한 가상 화면입니다. 실제 프로필 등록이나 지원권 지급은 이루어지지 않습니다.</p></div>
  </main>
</React.StrictMode>);
