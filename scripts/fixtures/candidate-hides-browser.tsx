import { useState } from "react";
import { createRoot } from "react-dom/client";
import { CandidateHideButton, CandidateHidesPanel } from "@/components/dating/CandidateHides";
const source = "00000000-0000-4000-8000-000000000011";
const candidate = "00000000-0000-4000-8000-000000000012";
function Preview() {
  const [hidden, setHidden] = useState(false);
  const [revision, setRevision] = useState(0);
  const [enabled, setEnabled] = useState(true);
  return <main className="mx-auto max-w-lg p-4">
    <p className="text-xs text-neutral-500">로컬 검증 화면 · 실제 회원 아님</p>
    <section aria-label="추천 후보" className="mt-3 rounded-2xl border border-neutral-200 bg-white p-4">
      <h1 className="font-semibold">1대1 매칭</h1>
      <p className="mt-1 text-xs text-neutral-500">마음에 드는 분에게 요청을 보내보세요.</p>
      {!hidden && <article className="mt-4 rounded-xl border border-neutral-200 p-3">
        <p className="text-sm font-semibold">예시 후보 / 29세 / 서울</p>
        <p className="mt-1 text-xs text-neutral-500">서로 편하게 이야기할 수 있는 분을 만나고 싶어요.</p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button type="button" className="min-h-11 rounded-xl bg-[#f0003d] px-3 text-xs font-semibold text-white">매칭 요청 보내기</button>
          <button type="button" className="min-h-11 rounded-xl border border-neutral-300 px-3 text-xs">♡ 찜</button>
          <CandidateHideButton enabled={enabled} sourceCardId={source} candidateId={candidate} ticket="local-receipt"
            onHidden={() => { setHidden(true); setRevision(value => value + 1); }} />
        </div>
      </article>}
      <CandidateHidesPanel enabled={enabled} revision={revision}
        onRestored={async () => { setHidden(false); setRevision(value => value + 1); }} />
    </section>
    <section aria-label="진행 중인 매칭" className="mt-3 rounded-xl border border-neutral-200 p-3 text-xs">
      서로 수락한 매칭 · 연락처 교환 가능
    </section>
    <button type="button" className="mt-4 text-xs" onClick={() => setEnabled(value => !value)}>설치 상태 전환</button>
  </main>;
}
createRoot(document.getElementById("root")!).render(<Preview />);
