"use client";

import { useId, useState, type ReactNode } from "react";

// Keep photos and existing actions visible; only the long profile text is folded.
export default function OneOnOneProfileSummary({
  intro, strengths, preferredPartner, children, photos,
}: {
  intro?: string | null;
  strengths?: string | null;
  preferredPartner?: string | null;
  children: ReactNode;
  photos?: ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);
  const detailsId = useId();
  const hasDetails = Boolean(intro?.trim() || strengths?.trim() || preferredPartner?.trim());

  return (
    <div data-profile-summary>
      {photos}
      {intro && !expanded ? <p className="mt-3 line-clamp-2 whitespace-pre-wrap break-words text-[13px] leading-6 text-neutral-700">{intro}</p> : null}
      {photos === undefined ? children : null}
      {hasDetails ? (
        <>
          <button
            type="button"
            aria-expanded={expanded}
            aria-controls={detailsId}
            onClick={() => setExpanded((value) => !value)}
            className="mt-1 inline-flex min-h-[44px] items-center gap-1 text-xs font-medium text-neutral-600 hover:text-neutral-900 focus-visible:outline-2 focus-visible:outline-rose-500"
          >
            {expanded ? "소개 접기" : "소개 더보기"}
            <span aria-hidden="true">{expanded ? "⌃" : "⌄"}</span>
          </button>
          <div id={detailsId} hidden={!expanded} className="border-t border-neutral-100 pt-2 text-[13px] leading-6 text-neutral-700">
            {intro ? <p className="whitespace-pre-wrap break-words">{intro}</p> : null}
            {strengths ? <p className="mt-2 whitespace-pre-wrap break-words"><span className="font-semibold">장점</span> · {strengths}</p> : null}
            {preferredPartner ? <p className="mt-2 whitespace-pre-wrap break-words"><span className="font-semibold">원하는 점</span> · {preferredPartner}</p> : null}
          </div>
        </>
      ) : null}
      {photos !== undefined ? children : null}
    </div>
  );
}
