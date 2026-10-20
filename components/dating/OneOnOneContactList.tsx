"use client";

import { Fragment, useState, type ReactNode } from "react";
import { groupContactPresentation, type ContactPresentationMatch } from "@/lib/dating-1on1-contact-presentation";

export default function OneOnOneContactList<T extends ContactPresentationMatch>({
  matches, renderMatch, initialVisibleCount = Number.POSITIVE_INFINITY, pageSize = 3,
  moreLabel = "진행할 매칭 더보기", listClassName = "space-y-2",
}: {
  matches: readonly T[];
  renderMatch: (match: T) => ReactNode;
  initialVisibleCount?: number;
  pageSize?: number;
  moreLabel?: string;
  listClassName?: string;
}) {
  // Keep groups stable while the member is reading/paying; no timers or extra API calls.
  const [now] = useState(() => Date.now());
  const [visibleCount, setVisibleCount] = useState(initialVisibleCount);
  const [olderOpen, setOlderOpen] = useState(false);
  const [olderCount, setOlderCount] = useState(3);
  const { current, older } = groupContactPresentation(matches, now);
  return <>
    <div className={listClassName}>
      {current.slice(0, visibleCount).map(match => <Fragment key={match.id}>{renderMatch(match)}</Fragment>)}
    </div>
    {current.length > visibleCount ? <button type="button" onClick={() => setVisibleCount(count => count + pageSize)}
      className="min-h-[44px] w-full rounded-xl border border-neutral-200 text-xs font-medium text-neutral-600">
      {moreLabel} · {current.length - visibleCount}건
    </button> : null}
    {older.length ? <details className="mt-2 rounded-xl border border-neutral-200 bg-white px-3"
      onToggle={event => setOlderOpen(event.currentTarget.open)}>
      <summary className="min-h-[44px] cursor-pointer content-center py-2 text-xs font-medium text-neutral-600">
        이전 미교환 매칭 · {older.length}건
      </summary>
      {olderOpen ? <div className="pb-3">
        <p className="mb-2 text-[11px] leading-5 text-neutral-500">수락 후 7일 이상 지난 매칭이에요. 연결은 유지되며, 여기서 계속 진행할 수 있어요.</p>
        <div className={listClassName}>
          {older.slice(0, olderCount).map(match => <Fragment key={match.id}>{renderMatch(match)}</Fragment>)}
        </div>
        {older.length > olderCount ? <button type="button" onClick={() => setOlderCount(count => count + 3)}
          className="min-h-[44px] w-full text-xs text-neutral-600">이전 매칭 더보기 · {older.length - olderCount}건</button> : null}
      </div> : null}
    </details> : null}
  </>;
}
