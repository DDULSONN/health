"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { canOfferOneOnOneContact, oneOnOneMatchHref, oneOnOneNextStep } from "@/lib/dating-1on1-match-navigation";
import OneOnOneContactList from "@/components/dating/OneOnOneContactList";
import type { ContactPresentationMatch } from "@/lib/dating-1on1-contact-presentation";

type Match = ContactPresentationMatch & {
  counterparty_card?: { name?: string | null; display_nickname?: string | null; nickname?: string | null; photo_signed_urls?: string[] } | null;
};

function hasDecliningReply(match: Match) {
  return match.contact_nudge?.sent_by_me?.reply?.preset_key === "not_right_now";
}

function canFeatureExchange(match: Match) {
  return canOfferOneOnOneContact(match) && !hasDecliningReply(match);
}

function CounterpartyPhoto({ src }: { src?: string }) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  return src && src !== failedSrc ? (
    // Participant API returns the existing protected image proxy, never a public original.
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt="" width={40} height={48} loading="lazy" onError={() => setFailedSrc(src)} className="h-12 w-10 shrink-0 rounded-lg bg-neutral-100 object-cover" />
  ) : <span aria-hidden="true" className="flex h-12 w-10 shrink-0 items-center justify-center rounded-lg bg-neutral-100 text-xs text-neutral-400">1:1</span>;
}

export default function OneOnOneNextSteps<T extends Match>({ matches, renderContact, homePreview = false, focusedMatchId }: {
  matches: readonly T[];
  renderContact?: (match: T) => ReactNode;
  homePreview?: boolean;
  focusedMatchId?: string;
}) {
  const items = matches.filter((match) => match.counterparty_card && oneOnOneNextStep(match));
  if (!items.length) return null;
  const readyCount = homePreview ? items.filter(canFeatureExchange).length : 0;
  return <section aria-label="이어서 진행할 1:1 매칭" className="mb-3 rounded-xl border border-rose-200 bg-white px-3 py-2">
    <p className="py-1 text-sm font-semibold text-neutral-800">{readyCount ? "연락처 교환 대기" : "이어서 진행하기"} <span className="text-[#f0003d]">{readyCount || items.length}건</span></p>
    <OneOnOneContactList matches={items} initialVisibleCount={3} listClassName="divide-y divide-neutral-100"
      feature={homePreview && renderContact && !focusedMatchId ? canFeatureExchange : undefined}
      renderMatch={(match, isFeatured) => {
        const exchange = canOfferOneOnOneContact(match);
        // Keep one actionable offer visible on home. A focused match already
        // owns its full form, including any reply and the existing privacy choice.
        const declines = hasDecliningReply(match);
        const showOffer = renderContact && exchange && (!homePreview || isFeatured);
        return <article key={match.id} className="py-2">
          <Link href={oneOnOneMatchHref(match.id)} className="flex min-h-[48px] items-center gap-3 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-700">
            <CounterpartyPhoto src={match.counterparty_card?.photo_signed_urls?.[0]} />
            <span className="min-w-0 flex-1 break-words font-medium text-neutral-900">{match.counterparty_card?.name || match.counterparty_card?.display_nickname || match.counterparty_card?.nickname || "1:1 상대"}</span>
            <span className="shrink-0 text-xs font-semibold text-[#f0003d]">{showOffer ? "프로필 보기"
              : homePreview && exchange ? declines ? "답장 확인" : "교환 안내 보기"
                : oneOnOneNextStep(match)} ›</span>
          </Link>
          {showOffer ? renderContact(match) : null}
        </article>;
      }} />
  </section>;
}
