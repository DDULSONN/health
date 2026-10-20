import { useState } from "react";
import { createRoot } from "react-dom/client";
import OneOnOneContactOffer from "@/components/dating/OneOnOneContactOffer";
import ContactPaymentRecovery from "@/components/dating/ContactPaymentRecovery";
import OneOnOneNextSteps from "@/components/dating/OneOnOneNextSteps";

function PresentationFixture() {
  const [received, setReceived] = useState(false);
  const [selected, setSelected] = useState("");
  const [now] = useState(Date.now);
  const date = (days: number) => new Date(now - days * 86400000).toISOString();
  const make = (id: string, name: string, days: number) => ({
    id, state: "mutual_accepted", contact_exchange_status: "none",
    created_at: date(40), source_final_responded_at: date(days),
    counterparty_card: { name },
    contact_nudge: {
      available: true, can_send: false, sent_by_me: null, eligible_at: null,
      received_from_other: id === "old-0" && received ? {
        preset_key: "coffee_on_me" as const, message_text: "연락처 교환해 주시면 첫 커피는 제가 살게요 ☕",
        sender_display_name: name, created_at: date(0),
      } : null,
    },
  });
  const matches = [make("old-0", "이전상대0", 20), make("recent-second", "어제수락", 1),
    make("recent-latest", "최근수락", 0.1), make("recent-third", "이틀전수락", 2),
    ...[1, 2, 3].map(n => make(`old-${n}`, `이전상대${n}`, 20 + n))];
  return <section aria-label="매칭 정렬 검증" className="mt-8">
    <label className="block py-3 text-xs"><input type="checkbox" checked={received} onChange={e => setReceived(e.target.checked)} />이전 상대의 새 한마디 수신</label>
    <output aria-label="선택한 매칭">{selected}</output>
    <OneOnOneNextSteps matches={matches} renderContact={item => <OneOnOneContactOffer compact
      matchId={item.id} name={item.counterparty_card.name} included={false} processing={selected === item.id}
      nudge={item.contact_nudge} nudgeProcessing={false} onExchange={id => setSelected(id)} onNudge={() => { throw Error("Not allowed"); }} />} />
  </section>;
}

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
    <PresentationFixture />
  </main>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);
