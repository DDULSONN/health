import { createRoot } from "react-dom/client";
import ContactCarePanel from "@/components/dating/ContactCarePanel";
import OneOnOneProfileStateNotice from "@/components/dating/OneOnOneProfileStateNotice";

const view = new URLSearchParams(window.location.search).get("view") || "vouchers";
const profile = view === "archived" || view === "held";
const views = [["vouchers", "교환권 보유"], ["apply", "지원 신청"], ["archived", "내린 프로필"], ["held", "공개 보류"]];
createRoot(document.getElementById("root")!).render(<div className="min-h-screen bg-neutral-50 text-neutral-900">
  <header className="border-b border-neutral-200 bg-white px-5 py-4"><div className="mx-auto max-w-lg text-xl font-bold">짐툴</div></header>
  <main className="mx-auto max-w-lg space-y-4 px-3 py-5">
    <div><p className="text-xs text-neutral-500">로컬 미리보기 · 가상 데이터 · 실제 결제·지급 없음</p><h1 className="mt-2 text-xl font-bold">{profile ? "1대1 매칭" : "마이페이지"}</h1></div>
    <nav aria-label="미리보기 화면" className="flex flex-wrap gap-2">
      {views.map(([key, label]) => <a key={key} href={`/?view=${key}&care=1`} aria-current={view === key ? "page" : undefined} className={`inline-flex min-h-11 items-center rounded-lg px-3 text-xs font-medium ${view === key ? "bg-neutral-900 text-white" : "border border-neutral-200 bg-white text-neutral-600"}`}>{label}</a>)}
    </nav>
    <section className="rounded-xl border border-neutral-200 bg-white p-4">
      <h2 className="mb-3 text-base font-bold">{profile ? "프로필 상태" : "1:1 진행 내역"}</h2>
      {profile ? <><OneOnOneProfileStateNotice profile={{ status: "rejected", archived: view === "archived" }} showManageLink />
        <div className="mt-4 rounded-xl border border-neutral-200 p-3"><p className="text-sm font-semibold">기존 매칭 내역</p><p className="mt-1 text-xs leading-5 text-neutral-500">매칭·결제·연락처 표시 조건은 기존과 같아요.</p></div></> : <ContactCarePanel />}
    </section>
  </main>
</div>);
