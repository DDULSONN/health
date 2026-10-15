import { useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import OneOnOneNextSteps from "@/components/dating/OneOnOneNextSteps";
import OneOnOneContactOffer from "@/components/dating/OneOnOneContactOffer";
import OneOnOneRefreshControl from "@/components/dating/OneOnOneRefreshControl";
import type { OneOnOneContactNudgeSummary, OneOnOneContactNudgePresetKey } from "@/lib/dating-1on1-contact-nudge";

const id = "00000000-0000-4000-8000-000000000003";
const match = { id, state: "mutual_accepted", contact_exchange_status: "awaiting_applicant_payment", counterparty_card: { name: "한글테스트상대", photo_signed_urls: ["/test-photo.webp"] } };
function Fixture() {
  const [nudge, setNudge] = useState<OneOnOneContactNudgeSummary>({ available: true, eligible_at: new Date().toISOString(), can_send: true, sent_by_me: null, received_from_other: null });
  const [sending, setSending] = useState(false), [clicks, setClicks] = useState(0), [plus, setPlus] = useState(false), [remaining, setRemaining] = useState(0);
  const lock = useRef(false);
  async function send(matchId: string, presetKey: OneOnOneContactNudgePresetKey) {
    if (lock.current) return; lock.current = true; setSending(true);
    try {
      const res = await fetch(`/api/dating/1on1/matches/${matchId}/nudge`, {method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify({presetKey})});
      const body = await res.json();
      if (!res.ok) throw Error(body.error);
      setNudge(current => ({ ...current, can_send: false, sent_by_me: body.nudge }));
    } finally { lock.current = false; setSending(false); }
  }
  return <main className="mx-auto max-w-lg space-y-4 bg-white p-3">
    <h1 className="text-lg font-semibold">1대1 매칭</h1>
    <output aria-label="기존 결제 동작 호출">{clicks}</output>
    <OneOnOneNextSteps matches={[match]} renderContact={item => <OneOnOneContactOffer compact matchId={item.id} name={item.counterparty_card.name}
      included={false} processing={false} nudge={nudge} nudgeProcessing={sending} onExchange={() => setClicks(n => n + 1)} onNudge={send} />} />
    <h2 className="text-base font-semibold">추천 후보</h2>
    <label className="block"><input type="checkbox" checked={plus} onChange={e => setPlus(e.target.checked)} />플러스 적용 중</label>
    <label className="block"><input type="checkbox" checked={remaining > 0} onChange={e => setRemaining(e.target.checked ? 1 : 0)} />남은 횟수 있음</label>
    <OneOnOneRefreshControl usage={{refresh_limit:plus?2:1,refresh_remaining:remaining,can_refresh:remaining>0,refresh_bonus_remaining:0}}
      busy={false} onRequest={() => {}} plusOffer={{cardId:"test-card",active:plus}} />
  </main>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);
