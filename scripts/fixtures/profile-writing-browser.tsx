import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import Home from "../../app/community/dating/cards/page";
import Onboarding from "../../app/onboarding/dating/page";
import Signup from "../../app/signup/page";
import PhoneVerification from "../../app/phone-verification/page";
import DatingDraftResumeCard from "../../components/dating/DatingDraftResumeCard";
import { useDatingDraftResume } from "../../lib/use-dating-draft-resume";
import { createClient } from "@/lib/supabase/client";
import { writeDatingDraft } from "../../lib/dating-onboarding-draft";
import ViewerSexSelection from "../../components/dating/ViewerSexSelection";

// Local-only fixture identity and text. Never connects to live accounts or services.
if (new URLSearchParams(location.search).get("preview") === "resume") {
  writeDatingDraft({ version: 1, userId: "fixture-member", savedAt: Date.now(), step: 1,
    targets: { open: true, oneOnOne: true }, fields: {
      nickname: "테스트", sex: "female", name: "미리보기", birthYear: "1996", heightCm: "165",
      job: "회사원", region: "서울", introText: "", strengthsText: "", preferredPartnerText: "",
      smoking: "non_smoker", workoutFrequency: "", trainingYears: "", instagramId: "",
      total3Lift: "", photoVisibility: "blur",
    } });
}
const client = createClient();
if (new URLSearchParams(location.search).get("visitor") === "guest") {
  (window as unknown as { fixtureAuthMode: string }).fixtureAuthMode = "guest";
}
function DraftOnly() {
  const draft = useDatingDraftResume("fixture-member", client.auth);
  return draft ? <DatingDraftResumeCard draft={draft} href="/onboarding/dating" /> : <p>저장된 프로필 없음</p>;
}
function SexPreview() {
  const [selected, setSelected] = useState("");
  return <main className="mx-auto max-w-xl px-4 py-6"><ViewerSexSelection saving={false} error="" onSelect={setSelected} />{selected && <div role="status" className="rounded-xl bg-white p-4 text-sm text-neutral-600"><p>{selected === "male" ? "여자" : "남자"} 오픈카드 목록으로 이어져요. 실제 성별 정보는 저장하지 않았어요.</p><a href="/community/dating/cards?tab=open_cards&entry-preview=1" className="mt-3 inline-flex min-h-11 items-center font-semibold text-rose-600">선택 후 홈 보기 →</a></div>}</main>;
}
const polish = new URLSearchParams(location.search).has("entry-preview");
createRoot(document.getElementById("root")!).render(<StrictMode>
  {polish && <nav aria-label="미리보기 화면" className="flex flex-wrap justify-center gap-2 border-b border-neutral-200 bg-white px-4 py-3 text-xs text-neutral-600">{[
    ["/community/dating/cards?tab=open_cards&visitor=guest", "가입 전 홈"], ["/community/dating/cards?tab=open_cards", "가입 후 홈"],
    ["/signup", "가입"], ["/phone-verification?next=/onboarding/dating", "번호 인증"], ["/preview/first-sex", "첫 성별 선택"], ["/onboarding/dating", "프로필 작성"],
  ].map(([href,label])=><a key={href} href={href+(href.includes("?")?"&":"?")+"entry-preview=1"} className="rounded-lg border border-neutral-200 px-3 py-2 hover:bg-neutral-50">{label}</a>)}</nav>}
  {location.pathname === "/preview/draft-hook" ? <DraftOnly /> :
    location.pathname === "/preview/first-sex" ? <SexPreview /> :
    location.pathname === "/signup" ? <Signup /> :
    location.pathname === "/phone-verification" ? <PhoneVerification /> :
    location.pathname === "/onboarding/dating" ? <Onboarding /> : <Home />}
</StrictMode>);
