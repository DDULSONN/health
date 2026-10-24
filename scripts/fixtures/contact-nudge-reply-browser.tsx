import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import OneOnOneContactOffer from "../../components/dating/OneOnOneContactOffer";
import type { OneOnOneContactNudgeSummary } from "../../lib/dating-1on1-contact-nudge";

const role = new URLSearchParams(location.search).get("role") === "sender" ? "sender" : "recipient";
const matchId = "00000000-0000-4000-8000-000000000010";
function App() {
  const [nudge, setNudge] = useState<OneOnOneContactNudgeSummary | null>(null);
  const [notice, setNotice] = useState("");
  const [sending, setSending] = useState(false);
  async function sendGreeting(id: string, presetKey: string) {
    if (sending) return;
    setSending(true);
    try {
      const res = await fetch(`/api/dating/1on1/matches/${id}/nudge`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ presetKey }) });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error);
      const data = await (await fetch(`/api/preview/summary?role=${role}`)).json();
      setNudge(data.items[0]?.contact_nudge ?? null);
      setNotice("인사를 보냈어요. 로컬 가상 계정에만 저장됐어요.");
    } catch (e) { setNotice(e instanceof Error ? e.message : "다시 시도해 주세요."); }
    finally { setSending(false); }
  }
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/preview/summary?role=${role}`, { signal: controller.signal }).then(r => r.json()).then(data => {
      if (!controller.signal.aborted) setNudge(data.items[0]?.contact_nudge ?? null);
    }).catch(() => {});
    return () => controller.abort();
  }, []);
  return <div className="min-h-screen bg-neutral-50 text-neutral-900">
    <header className="border-b border-neutral-200 bg-white px-5 py-4 text-xl font-bold">짐툴</header>
    <main className="mx-auto max-w-lg px-4 pb-12 pt-5">
      <p className="text-xs leading-5 text-neutral-500">로컬 미리보기 · 가상 회원 · 실제 결제/발송 없음</p>
      <nav className="my-4 flex gap-2 text-xs" aria-label="미리보기 역할">
        <a className={`rounded-full border px-3 py-2 ${role === "recipient" ? "bg-neutral-900 text-white" : "bg-white"}`} href="/?role=recipient">받는 사람 화면</a>
        <a className={`rounded-full border px-3 py-2 ${role === "sender" ? "bg-neutral-900 text-white" : "bg-white"}`} href="/?role=sender">보낸 사람 화면</a>
      </nav>
      <h1 className="mb-4 text-xl font-bold">1대1 매칭</h1>
      <section className="rounded-2xl border border-neutral-200 bg-white p-4">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <div><p className="font-bold">{role === "recipient" ? "지후" : "서연"} · 29세</p><p className="mt-1 text-xs text-neutral-500">서울 · 가상 프로필</p></div>
          <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700">서로 수락</span>
        </div>
        {nudge ? <OneOnOneContactOffer matchId={matchId} name={role === "recipient" ? "지후" : "서연"}
          nudge={nudge} included={false} processing={false} nudgeProcessing={sending}
          onExchange={() => setNotice("번호교환 버튼은 기존처럼 동작해요. 미리보기에서는 실제 결제하지 않아요.")}
          onNudge={(id,preset) => void sendGreeting(id,preset)} /> : <p>불러오는 중...</p>}
        {notice ? <p role="status" className="mt-3 text-xs leading-5 text-neutral-600">{notice}</p> : null}
      </section>
      <p className="mt-3 text-xs leading-5 text-neutral-500">답장을 보낸 뒤 위의 ‘보낸 사람 화면’에서 상대에게 어떻게 보이는지 확인할 수 있어요.</p>
    </main>
  </div>;
}
createRoot(document.getElementById("root")!).render(<App />);
