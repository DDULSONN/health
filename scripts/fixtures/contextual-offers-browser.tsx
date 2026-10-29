import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import OpenCardExtras from "@/components/dating/OpenCardExtras";
import InstantOpenCardHint from "@/components/dating/InstantOpenCardHint";
import CompactPaidOffer from "@/components/dating/CompactPaidOffer";
import NearbyViewPage from "@/app/dating/nearby-view/page";
import { canOfferInstantOpenCard } from "@/lib/paid-application-prefill";

const query = new URLSearchParams(location.search);
function ExtrasFixture() {
  const [userId, setUserId] = useState<string | null>(query.has("guest") ? null : "fixture-a");
  useEffect(() => {
    (window as unknown as { setFixtureUser: typeof setUserId }).setFixtureUser = setUserId;
  }, []);
  const showInstant = canOfferInstantOpenCard(query.has("pending"), {
    ready: true, loading: false, error: null,
    card: query.has("paid") ? { status: "approved" } : null,
    presentation: { active: query.has("paid") },
  });
  return <main className="mx-auto max-w-3xl p-4">
    <h1 className="mb-4 text-xl font-bold">오픈카드</h1>
    <OpenCardExtras userId={userId} />
    {showInstant ? <InstantOpenCardHint /> : null}
    <p className="mt-5 text-sm text-neutral-500">후보 목록이 이어져요.</p>
    {query.has("tracking") ? <div style={{ marginTop: 1300 }}>
      <CompactPaidOffer title="추가 노출 검사" description="로컬 검사" itemId="apply_credits" amount={5000} placement="fixture_offscreen">
        <button type="button" disabled>비활성 버튼</button>
      </CompactPaidOffer>
    </div> : null}
  </main>;
}
createRoot(document.getElementById("root")!).render(
  location.pathname === "/fixture-checkout" ? <p>가상 결제창 · 실제 결제 없음</p> :
  location.pathname.includes("nearby-view") ? <NearbyViewPage /> : <ExtrasFixture />
);
