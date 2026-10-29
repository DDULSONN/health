"use client";

import type { ReactNode } from "react";
import { usePaidOfferTracking } from "@/lib/use-paid-offer-tracking";

export default function CompactPaidOffer({ title, description, itemId, amount, placement, children }: {
  title: string; description: ReactNode; itemId: string; amount: number; placement: string; children: ReactNode;
}) {
  const { ref, selected } = usePaidOfferTracking(itemId, title, amount, placement);
  return (
    <div ref={ref} role="region" aria-label={title}
      className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-xl border border-neutral-200 bg-white px-3 py-2.5 text-xs font-semibold"
      onClickCapture={event => {
        const action = (event.target as Element).closest?.("a,button");
        if (action && !action.hasAttribute("disabled") && action.getAttribute("aria-disabled") !== "true") selected();
      }}>
      <div className="min-w-0 flex-1 basis-44">
        <p className="text-xs font-semibold leading-5 text-neutral-900">{title}</p>
        <div className="mt-0.5 text-[11px] font-normal leading-5 text-neutral-500">{description}</div>
      </div>
      {children}
    </div>
  );
}
