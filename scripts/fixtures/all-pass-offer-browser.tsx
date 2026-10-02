import React from "react";
import { createRoot } from "react-dom/client";
import AllPassProfileOfferBanner from "../../components/dating/AllPassProfileOfferBanner";
import DatingPlusOffers from "../../components/dating/DatingPlusOffers";
import { fixtureAuth } from "./return-reward-adapters";
declare global { interface Window { allPassFixture: { auth: typeof fixtureAuth } } }
window.allPassFixture = { auth: fixtureAuth };
if (new URLSearchParams(location.search).get("preview") === "anonymous") fixtureAuth(null);
createRoot(document.getElementById("root")!).render(<React.StrictMode>
  <header className="border-b border-neutral-100 bg-white px-5 py-5 text-xl font-bold">짐툴</header>
  <main className="mx-auto max-w-5xl px-3 py-4 md:px-6 md:py-7">
    <nav className="mb-3 grid grid-cols-3 gap-1 rounded-xl border border-neutral-200 bg-white p-1 text-center text-sm font-semibold">
      <span className="rounded-lg bg-neutral-950 px-2 py-3 text-white">오픈카드</span><span className="px-2 py-3">1:1 매칭</span><span className="px-2 py-3">빠른매칭</span>
    </nav>
    <AllPassProfileOfferBanner placement="local_preview" />
    <section className="rounded-2xl border border-neutral-200 bg-white p-4"><h2 className="mb-3 text-base font-bold">내 추천 후보</h2><p className="text-sm leading-6 text-neutral-500">이 아래 기존 프로필과 추천 후보가 그대로 표시됩니다.</p></section>
    {new URLSearchParams(location.search).has("plans") && <div className="mt-8"><DatingPlusOffers mode="one_on_one" placement="local_plans" /></div>}
  </main>
</React.StrictMode>);
