import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import Home from "../../app/community/dating/cards/page";
import Onboarding from "../../app/onboarding/dating/page";
import DatingDraftResumeCard from "../../components/dating/DatingDraftResumeCard";
import { useDatingDraftResume } from "../../lib/use-dating-draft-resume";
import { createClient } from "@/lib/supabase/client";
import { writeDatingDraft } from "../../lib/dating-onboarding-draft";

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
function DraftOnly() {
  const draft = useDatingDraftResume("fixture-member", client.auth);
  return draft ? <DatingDraftResumeCard draft={draft} href="/onboarding/dating" /> : <p>저장된 프로필 없음</p>;
}
createRoot(document.getElementById("root")!).render(<StrictMode>
  {location.pathname === "/preview/draft-hook" ? <DraftOnly /> :
    location.pathname === "/onboarding/dating" ? <Onboarding /> : <Home />}
</StrictMode>);
