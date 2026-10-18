import { createRoot } from "react-dom/client";
import ContactCarePanel from "@/components/dating/ContactCarePanel";
import AdminContactCarePanel from "@/components/admin/AdminContactCarePanel";
import ContactCareAnnouncement from "@/components/dating/ContactCareAnnouncement";

createRoot(document.getElementById("root")!).render(<main className="mx-auto max-w-lg space-y-4 p-3">
  {new URLSearchParams(window.location.search).has("notice") ? <ContactCareAnnouncement /> : null}
  <p className="text-xs text-neutral-500">로컬 검증 화면 · 실제 신청/지급 아님</p>
  <section aria-label="교환 완료 카드" className="rounded-xl border border-neutral-200 bg-neutral-50 p-3">
    <p className="mb-2 text-sm font-semibold">예시 상대 · 번호 교환 완료</p>
    <p className="mb-3 text-xs text-neutral-500">실제 번호는 표시하지 않는 미리보기입니다.</p>
    <ContactCarePanel matchId="00000000-0000-4000-8000-000000000010" />
  </section>
  <section aria-label="회원 화면"><ContactCarePanel /></section>
  <section aria-label="관리자 화면"><AdminContactCarePanel /></section>
</main>);
