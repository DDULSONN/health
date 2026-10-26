import { createRoot } from "react-dom/client";
import MyPage from "../../app/mypage/page";
import Home from "../../app/community/dating/cards/page";
import DatingPlusOffers from "@/components/dating/DatingPlusOffers";

const plans = location.pathname === "/plans";
createRoot(document.getElementById("root")!).render(<>
  <header className="border-b border-neutral-100 bg-white px-4 py-3 text-neutral-950">
    <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-2">
      <strong className="text-xl">짐툴</strong><span className="text-[11px] text-neutral-500">로컬 미리보기 · 가상 회원 · 실제 결제·저장 없음</span>
    </div>
    <nav className="mx-auto mt-3 flex max-w-3xl flex-wrap gap-3 text-xs text-neutral-600">
      <a href="/mypage?section=matching&match=all">마이페이지</a>
      <a href="/community/dating/cards?tab=one_on_one">1대1 매칭</a>
      <a href="/mypage?section=settings">설정·문의</a>
      <a href="/plans">플러스</a>
    </nav>
  </header>
  {plans ? <main className="mx-auto max-w-md p-4"><h1 className="mb-3 text-base font-semibold text-neutral-950">플러스 이용권</h1><DatingPlusOffers mode="one_on_one" placement="local_tone_preview" oneOnOneCardId="fixture-one" /></main>
    : location.pathname === "/mypage" ? <MyPage /> : <Home />}
</>);
