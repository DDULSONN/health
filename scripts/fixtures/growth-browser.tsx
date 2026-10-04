import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import GrowthPrompts from "../../components/GrowthPrompts";
import ReferralInvitePanel from "../../components/ReferralInvitePanel";
import SignupPage from "../../app/signup/page";
import { recordGrowthProfileCreated } from "../../lib/growth-analytics";
const win = window as unknown as { fixtureProfileSaved: typeof recordGrowthProfileCreated; fixtureSubmits: number };
win.fixtureProfileSaved = recordGrowthProfileCreated;
win.fixtureSubmits = 0;
createRoot(document.getElementById("root")!).render(<StrictMode>
  <GrowthPrompts />
  {location.pathname === "/signup" ? <SignupPage /> : <main className="mx-auto max-w-lg p-4">
    <h1 className="mb-4 text-xl font-bold">{location.pathname === "/preview/credits" ? "지원권을 모두 사용했어요" : "1대1 매칭"}</h1>
    {location.pathname === "/preview/credits" ? <form onSubmit={event => { event.preventDefault(); win.fixtureSubmits++; }}>
      <p className="mb-2 text-sm text-neutral-600">지원권 5장 · 5,000원</p>
      <ReferralInvitePanel compact placement="credits_empty" />
      <button type="submit" className="mt-4 min-h-11 rounded-lg bg-rose-500 px-4 text-white">지원하기</button>
    </form> : <p className="text-sm text-neutral-500">검증용 화면 · 실제 회원 등록/결제 없음</p>}
  </main>}
</StrictMode>);
