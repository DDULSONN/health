"use client";

import { useId, useState, type ReactNode } from "react";

// Keep photos and existing actions visible; only the long profile text is folded.
export default function OneOnOneProfileSummary({
  intro, strengths, preferredPartner, children,
}: {
  intro?: string | null;
  strengths?: string | null;
  preferredPartner?: string | null;
  children: ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);
  const detailsId = useId();
  const hasDetails = Boolean(intro?.trim() || strengths?.trim() || preferredPartner?.trim());

  return (
    <div data-profile-summary>
      {intro ? <p className="mt-2 line-clamp-2 whitespace-pre-wrap break-words text-xs leading-5 text-neutral-700">{intro}</p> : null}
      {children}
      {hasDetails ? (
        <>
          <button
            type="button"
            aria-expanded={expanded}
            aria-controls={detailsId}
            onClick={() => setExpanded((value) => !value)}
            className="mt-1 inline-flex min-h-[44px] items-center gap-1 text-xs font-medium text-neutral-500 hover:text-neutral-900"
          >
            {expanded ? "소개 접기" : "소개 더보기"}
            <span aria-hidden="true">{expanded ? "⌃" : "⌄"}</span>
          </button>
          <div id={detailsId} hidden={!expanded} className="border-t border-neutral-100 pt-2 text-xs leading-6 text-neutral-700">
            {intro ? <p className="whitespace-pre-wrap break-words">{intro}</p> : null}
            {strengths ? <p className="mt-2 whitespace-pre-wrap break-words"><span className="font-semibold">장점</span> · {strengths}</p> : null}
            {preferredPartner ? <p className="mt-2 whitespace-pre-wrap break-words"><span className="font-semibold">원하는 점</span> · {preferredPartner}</p> : null}
          </div>
        </>
      ) : null}
    </div>
  );
}
