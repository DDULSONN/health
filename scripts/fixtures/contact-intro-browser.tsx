import { useState } from "react";
import { createRoot } from "react-dom/client";
import OneOnOneContactOffer from "@/components/dating/OneOnOneContactOffer";

function Fixture() {
  const [included, setIncluded] = useState(false);
  const [other, setOther] = useState(false);
  const [request, setRequest] = useState("");
  return <main className="mx-auto max-w-xl p-4">
    <p className="mb-3 text-xs text-neutral-500">로컬 검증용 · 실제 결제 없음</p>
    <label><input type="checkbox" checked={included} onChange={e => setIncluded(e.target.checked)} />기존 무료 혜택</label>
    <label><input type="checkbox" checked={other} onChange={e => setOther(e.target.checked)} />다른 매칭</label>
    <section aria-label="연락처 교환" className="mt-3 rounded-2xl border border-neutral-200 bg-white p-4">
      <OneOnOneContactOffer matchId={`00000000-0000-4000-8000-00000000000${other ? 3 : 2}`} name="테스트상대"
        included={included} processing={false} nudgeProcessing={false} onNudge={() => {}}
        onExchange={(matchId, offerId) => setRequest(JSON.stringify({ matchId, offerId }))} />
    </section>
    <output aria-label="전달한 요청">{request}</output>
  </main>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);
