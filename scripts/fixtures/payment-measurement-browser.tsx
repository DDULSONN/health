import { useState } from "react";
import { createRoot } from "react-dom/client";
import OneOnOneContactOffer from "@/components/dating/OneOnOneContactOffer";
import { reportPaymentFailure } from "@/lib/payment-failure-client";

function Fixture() {
  const [clicks, setClicks] = useState(0);
  const [free, setFree] = useState(false);
  const [busy, setBusy] = useState(false);
  return <main style={{ maxWidth: 460, margin: "auto", padding: 12 }}>
    <h1>번호교환 측정 로컬 검증</h1>
    <label><input type="checkbox" checked={free} onChange={e => setFree(e.target.checked)} />무료 혜택</label>
    <label><input type="checkbox" checked={busy} onChange={e => setBusy(e.target.checked)} />처리 중</label>
    <button onClick={() => void reportPaymentFailure("measurement_test_order", "PAY_PROCESS_CANCELED")}>실패 기록 테스트</button>
    <output aria-label="기존 교환 핸들러 호출">{clicks}</output>
    <div style={{ height: 1200 }}>스크롤 아래 버튼은 아직 노출로 집계하면 안 됩니다.</div>
    <OneOnOneContactOffer matchId="00000000-0000-4000-8000-000000000003" name="테스트상대"
      included={free} processing={busy} nudgeProcessing={false}
      onExchange={() => setClicks(n => n + 1)} onNudge={() => {}} />
    <div style={{ height: 500 }} />
  </main>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);
