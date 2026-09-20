import { useState } from "react";
import { createRoot } from "react-dom/client";
import OneOnOneContactOffer from "@/components/dating/OneOnOneContactOffer";
import ContactPaymentRecovery from "@/components/dating/ContactPaymentRecovery";

function Fixture() {
  const [exchanges, setExchanges] = useState(0);
  const [messages, setMessages] = useState(0);
  const [included, setIncluded] = useState(false);
  const [received, setReceived] = useState(true);
  return <main className="mx-auto max-w-xl p-4">
    <p className="text-xs text-neutral-500">로컬 UI 검증용 · 실제 회원/결제 아님</p>
    <div className="my-3 flex gap-3 text-xs">
      <label><input type="checkbox" checked={included} onChange={e => setIncluded(e.target.checked)} />기존 무료 혜택</label>
      <label><input type="checkbox" checked={received} onChange={e => setReceived(e.target.checked)} />받은 한마디</label>
    </div>
    <section className="rounded-2xl border border-neutral-200 bg-neutral-50 p-3" aria-label="교환 안내">
      <OneOnOneContactOffer matchId="match" name="테스트상대" included={included} processing={false}
        nudgeProcessing={false} onExchange={() => setExchanges(n => n + 1)} onNudge={() => setMessages(n => n + 1)}
        nudge={{ available: true, can_send: true, eligible_at: null, sent_by_me: null,
          received_from_other: received ? { preset_key: "coffee_on_me", message_text: "연락처 교환해 주시면 첫 커피는 제가 살게요 ☕", sender_display_name: "테스트상대", created_at: new Date().toISOString() } : null }} />
    </section>
    <p className="my-2 text-xs" aria-label="작동 횟수">교환 {exchanges} · 문구 {messages}</p>
    <h2 className="mt-6 text-lg font-semibold">실패 후 복귀 화면</h2>
    <ContactPaymentRecovery orderId="fixture_order_123" />
  </main>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);
