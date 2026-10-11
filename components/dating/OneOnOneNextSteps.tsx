"use client";

import Link from "next/link";
import { useState } from "react";
import { oneOnOneMatchHref, oneOnOneNextStep } from "@/lib/dating-1on1-match-navigation";

type Match = {
  id: string; role?: string; state?: string; contact_exchange_status?: string;
  counterparty_card?: { name?: string | null; display_nickname?: string | null; nickname?: string | null } | null;
};

export default function OneOnOneNextSteps({ matches }: { matches: readonly Match[] }) {
  const [visibleCount, setVisibleCount] = useState(3);
  const items = matches.filter((match) => match.counterparty_card && oneOnOneNextStep(match));
  if (!items.length) return null;
  return <section aria-label="이어서 진행할 1:1 매칭" className="mb-3 rounded-xl border border-rose-200 bg-white px-3 py-2">
    <p className="py-1 text-xs font-semibold text-neutral-800">이어서 진행하기 <span className="text-[#f0003d]">{items.length}건</span></p>
    <div className="divide-y divide-neutral-100">
      {items.slice(0, visibleCount).map((match) => <Link key={match.id} href={oneOnOneMatchHref(match.id)}
        className="flex min-h-[48px] items-center justify-between gap-3 py-2 text-sm">
        <span className="min-w-0 break-words font-medium text-neutral-900">{match.counterparty_card?.name || match.counterparty_card?.display_nickname || match.counterparty_card?.nickname || "1:1 상대"}</span>
        <span className="shrink-0 text-xs font-semibold text-[#f0003d]">{oneOnOneNextStep(match)} ›</span>
      </Link>)}
    </div>
    {items.length > visibleCount ? <button type="button" onClick={() => setVisibleCount((count) => count + 3)}
      className="min-h-[44px] w-full text-xs text-neutral-600">진행할 매칭 더보기 · {items.length - visibleCount}건</button> : null}
  </section>;
}
