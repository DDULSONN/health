"use client";

import { useId } from "react";
import { readCandidateViewRange, type CandidateViewOptions } from "@/lib/dating-1on1-candidate-view";

export default function OneOnOneCandidateViewControls({ options, visible, total, change, reset }: {
  options: CandidateViewOptions;
  visible: number;
  total: number;
  change: (options: CandidateViewOptions) => void;
  reset: () => void;
}) {
  const statusId = useId();
  const { valid, min, max } = readCandidateViewRange(options);
  const changed = options.nearbyFirst || options.minAge !== "" || options.maxAge !== "";
  return <details className="mt-2 rounded-xl border border-neutral-200 bg-white px-3">
    <summary className="min-h-11 cursor-pointer content-center text-xs font-semibold text-neutral-700">
      후보 보기 조건 {changed ? <span className="font-normal text-neutral-500">· 설정됨</span> : null}
    </summary>
    <div className="space-y-2 border-t border-neutral-100 pb-3 pt-2 text-xs text-neutral-700">
      <label className="flex min-h-11 items-center gap-2 font-medium">
        <input type="checkbox" className="h-4 w-4 accent-rose-600" checked={options.nearbyFirst}
          onChange={event => change({ ...options, nearbyFirst: event.currentTarget.checked })} />
        내 등록 지역에서 가까운 순
      </label>
      <div className="grid grid-cols-2 gap-2" role="group" aria-label="표시할 나이 범위">
        <label className="flex min-w-0 flex-col gap-1 font-medium">
          최소 나이
          <input type="number" inputMode="numeric" min={19} max={120} step={1} placeholder="제한 없음"
            aria-describedby={statusId} aria-invalid={!valid} value={options.minAge}
            onChange={event => change({ ...options, minAge: event.currentTarget.value })}
            className="min-h-11 w-full min-w-0 rounded-lg border border-neutral-300 px-2 text-base" />
        </label>
        <label className="flex min-w-0 flex-col gap-1 font-medium">
          최대 나이
          <input type="number" inputMode="numeric" min={19} max={120} step={1} placeholder="제한 없음"
            aria-describedby={statusId} aria-invalid={!valid} value={options.maxAge}
            onChange={event => change({ ...options, maxAge: event.currentTarget.value })}
            className="min-h-11 w-full min-w-0 rounded-lg border border-neutral-300 px-2 text-base" />
        </label>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-x-2">
        <p id={statusId} role="status" className="leading-5 text-neutral-600">
          {!valid ? "19~120세에서 최소 나이와 최대 나이를 확인해 주세요."
            : (min !== null || max !== null) ? `받은 후보 ${total}명 중 ${visible}명 표시 · 새로고침 차감 없음`
              : "지금 받은 후보만 정리해요. 새로고침 횟수는 그대로예요."}
        </p>
        {changed ? <button type="button" onClick={reset} className="min-h-11 font-semibold underline underline-offset-2">조건 초기화</button> : null}
      </div>
    </div>
  </details>;
}
