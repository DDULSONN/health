import { useState } from "react";
import { createRoot } from "react-dom/client";
import Link from "next/link";
import OneOnOneHomePanel, { type OneOnOneHomeState } from "@/components/dating/OneOnOneHomePanel";
import OneOnOneContactOffer from "@/components/dating/OneOnOneContactOffer";
import ContactPriceUpdateNotice from "@/components/dating/ContactPriceUpdateNotice";
import PaymentMethodAnnouncement from "@/components/PaymentMethodAnnouncement";
import ContactCareAnnouncement from "@/components/dating/ContactCareAnnouncement";
import OpenCardEditor from "../../app/community/dating/cards/new/page";
import { hideReportedMatches, hideReportedRecommendations } from "@/lib/dating-report-visibility";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const candidate = { id: id(2), user_id: id(20), name: "미리보기 회원", age: 29, region: "경기 수원", height_cm: 174,
  job: "IT 서비스 개발자", intro_text: "평일에는 일하고 퇴근 후 가볍게 운동해요. 주말에는 산책하고 새로운 식당을 찾아다녀요. 편하게 대화하며 서로를 알아가고 싶어요.",
  strengths_text: "상대의 이야기를 잘 듣고 약속을 지켜요.", preferred_partner_text: "서로의 일상을 존중하며 자주 웃을 수 있는 분", photo_signed_urls: ["/fixture-photo.svg", "/fixture-photo.svg"] };
const initial: OneOnOneHomeState = { status: { canWrite: true, phoneVerified: true }, plus: null,
  myCards: [{ id: id(1), name: "내 프로필", status: "approved" }], matches: [],
  recommendations: [{ source_card_id: id(1), refresh_remaining: 1, refresh_limit: 1, can_refresh: true,
    recommendations: [candidate, { ...candidate, id: id(3), user_id: id(30), name: "두 번째 회원" }] }],
};
function Fixture() {
  const [data, setData] = useState(initial), [actions, setActions] = useState<string[]>([]);
  const add = (message: string) => setActions(values => [...values, message]);
  const mode = new URLSearchParams(location.search).get("mode");
  const [noticeOpen, setNoticeOpen] = useState(mode === "notice");
  if (location.pathname.includes('/cards/new')) return <OpenCardEditor />;
  return <main className="mx-auto max-w-2xl p-3">
    <nav className="mb-4 flex flex-wrap gap-4 text-xs"><Link href="/?mode=notice">공지 미리보기</Link><Link href="/?mode=candidates">추천 후보</Link><Link href="/?mode=contact">번호교환</Link><Link href="/?mode=guest">비회원</Link><Link href={`/community/dating/cards/new?editId=${id(1)}`}>사진 수정</Link></nav>
    {noticeOpen ? <ContactPriceUpdateNotice onClose={() => setNoticeOpen(false)} /> : null}
    {mode === "announcement" ? <><PaymentMethodAnnouncement /><ContactCareAnnouncement /></> : null}
    {mode === "contact" || mode === "notice" ? <section className="rounded-2xl border border-neutral-200 bg-white p-4">
      <OneOnOneContactOffer matchId={id(5)} name="미리보기 회원" included={false} processing={false} nudgeProcessing={false}
        nudge={{ available: true, can_send: true, received_from_other: null, sent_by_me: null, eligible_at: null }}
        onExchange={() => add("번호교환 버튼 클릭 · 실제 결제 없음")} onNudge={() => add("한마디 선택 · 실제 발송 없음")} />
    </section> : <OneOnOneHomePanel arrivedFromOnboarding={false} refreshNotice={null} onReported={result => {
      setData(current => ({ ...current, matches: hideReportedMatches(current.matches, result), recommendations: hideReportedRecommendations(current.recommendations, result) }));
      add(result.blocked ? "차단 성공 · 목록 재조회 실패 상황에서도 상대 제거" : "차단 실패 · 상대가 숨겨졌다고 안내하지 않음");
    }} onReload={() => add("명단 조회")} viewerLoggedIn={mode !== "guest"} profileStartHref="/onboarding/dating" profileStartCta="프로필 작성하기"
      loading={false} error="" sessionError={false} onRetrySession={() => {}} data={mode === "guest" ? null : data}
      processingMatchIds={[]} processingContactIds={[]} processingNudgeIds={[]} processingAutoKeys={[]} refreshingRecommendationIds={[]}
      onMatchAction={() => add("매칭 처리")} onContactCheckout={() => add("결제 준비")}
      onContactNudge={() => add("한마디 선택")} onAutoSelect={(_, target) => add(`매칭 요청: ${target}`)} onRefreshRecommendations={() => add("후보 새로고침")} />}
    <output aria-label="로컬 동작 기록" className="mt-4 block break-words text-xs text-neutral-500">{actions.join(" / ") || "동작 없음"}</output>
  </main>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);
