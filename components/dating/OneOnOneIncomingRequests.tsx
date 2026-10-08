"use client";

import { useId, useState, type ReactNode } from "react";

export default function OneOnOneIncomingRequests<T extends { id: string }>({
  requests, renderRequest,
}: {
  requests: readonly T[];
  renderRequest: (request: T) => ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);
  const [visibleCount, setVisibleCount] = useState(3);
  const listId = useId();
  if (!requests.length) return null;

  return (
    <section aria-label="받은 1:1 매칭 요청" className="mb-3 overflow-hidden rounded-xl border border-rose-200 bg-white">
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls={listId}
        onClick={() => setExpanded((value) => !value)}
        className="flex min-h-[52px] w-full items-center justify-between gap-3 bg-rose-50/60 px-3 py-2 text-left"
      >
        <span className="text-sm font-semibold text-neutral-900">나에게 온 요청 <span className="text-[#f0003d]">{requests.length}건</span></span>
        <span className="shrink-0 text-xs font-medium text-rose-700">{expanded ? "접기" : "확인하기"} <span aria-hidden="true">{expanded ? "⌃" : "›"}</span></span>
      </button>
      <div id={listId} hidden={!expanded}>
        {expanded ? (
          <div className="space-y-3 p-3">
            <p className="text-xs leading-5 text-neutral-500">상대 프로필을 보고 수락 여부를 결정해 주세요.</p>
            {requests.slice(0, visibleCount).map((request) => <div key={request.id}>{renderRequest(request)}</div>)}
            {requests.length > visibleCount ? (
              <button type="button" onClick={() => setVisibleCount((count) => count + 3)}
                className="min-h-[44px] w-full rounded-lg border border-neutral-200 text-xs font-medium text-neutral-700 hover:bg-neutral-50">
                받은 요청 더보기 · {requests.length - visibleCount}건
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}
