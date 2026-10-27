"use client";

import { useId, useState, type ReactNode } from "react";

export default function OneOnOneFavorites<T>({ items, renderCandidate }: {
  items: readonly T[];
  renderCandidate: (item: T) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [visible, setVisible] = useState(3);
  const listId = useId();
  if (!items.length) return null;
  return <section aria-label="찜한 후보" className="mb-3 rounded-xl border border-neutral-200 bg-white px-3">
    <button type="button" aria-expanded={open} aria-controls={listId} onClick={() => setOpen(value => !value)}
      className="flex min-h-[48px] w-full items-center justify-between gap-2 text-sm font-medium text-neutral-800">
      <span>찜한 후보 <span className="text-[#f0003d]">{items.length}명</span></span>
      <span className="text-xs text-neutral-500">{open ? "접기" : "보기"} <span aria-hidden="true">{open ? "⌃" : "›"}</span></span>
    </button>
    <div id={listId} hidden={!open}>
      {open ? <div className="space-y-3 pb-3">
        <p className="text-xs leading-5 text-neutral-500">찜은 상대에게 알려지지 않아요. 요청할 때 상대의 현재 상태를 다시 확인해요.</p>
        {items.slice(0, visible).map(renderCandidate)}
        {items.length > visible ? <button type="button" onClick={() => setVisible(count => count + 3)}
          className="min-h-[44px] w-full rounded-lg border border-neutral-200 text-xs font-medium text-neutral-700 hover:bg-neutral-50">
          찜한 후보 더보기 · {items.length - visible}명
        </button> : null}
      </div> : null}
    </div>
  </section>;
}
