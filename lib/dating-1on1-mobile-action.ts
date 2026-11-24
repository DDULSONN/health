import {
  canFeatureOneOnOneExchange, groupContactPresentation, ONE_ON_ONE_NEXT_STEPS_PREVIEW_COUNT,
  prioritizeFeaturedContact, type ContactPresentationMatch,
} from "./dating-1on1-contact-presentation";
import { oneOnOneNextStep } from "./dating-1on1-match-navigation";
import { getRegionCoordinate } from "./region-distance";

type VisibleMatch = ContactPresentationMatch & {
  counterparty_card?: unknown;
  counterparty_phone?: string | null;
  counterparty_instagram?: string | null;
};

export const ONE_ON_ONE_HOME_VISIBLE_MATCHES = 8;

// Display only: the shortcut never authorizes or performs the underlying action.
export function getOneOnOneMobileAction(
  incomingCount: number, matches: readonly VisibleMatch[], contactOfferAvailable: boolean, now: number,
) {
  if (incomingCount > 0) return { kind: "incoming", label: `받은 요청 ${incomingCount}건`, cta: "요청 보기" } as const;
  const { current } = groupContactPresentation(matches, now);
  // Match the initial NextSteps view, including its featured row. Never advertise
  // a final-accept action buried behind the "more" control.
  const { ordered } = prioritizeFeaturedContact(
    current.filter(match => match.counterparty_card && oneOnOneNextStep(match)),
    contactOfferAvailable ? canFeatureOneOnOneExchange : undefined,
  );
  const nextStepsPreview = ordered.slice(0, ONE_ON_ONE_NEXT_STEPS_PREVIEW_COUNT);
  if (nextStepsPreview.some(match => match.role === "source" && match.state === "candidate_accepted")) {
    return { kind: "next", label: "상대가 수락했어요", cta: "수락 여부 확인" } as const;
  }
  if (contactOfferAvailable && nextStepsPreview.some(canFeatureOneOnOneExchange)) {
    return { kind: "next", label: "서로 수락했어요", cta: "교환 안내 보기" } as const;
  }
  const exchangedMatch = current.slice(0, ONE_ON_ONE_HOME_VISIBLE_MATCHES).find(match =>
    match.counterparty_card && match.state === "mutual_accepted" && match.contact_exchange_status === "approved"
    && (match.counterparty_phone?.trim() || match.counterparty_instagram?.trim()));
  return exchangedMatch
    ? { kind: "exchanged", label: "연락처 교환 완료", cta: "연락처 보기", matchId: exchangedMatch.id } as const
    : null;
}

// Compare existing public profile regions only. Province centroids, conflicting
// inputs and raw location data are not displayed as a same-city assertion.
export function getSharedCandidateMunicipality(
  sourceRegion?: string | null, candidateRegion?: string | null,
): string | undefined {
  if (!sourceRegion || !candidateRegion) return undefined;
  const source = getRegionCoordinate(sourceRegion);
  const candidate = getRegionCoordinate(candidateRegion);
  if (source?.precision !== "city" || candidate?.precision !== "city" ||
      source.province !== candidate.province || !source.city || source.city !== candidate.city) return undefined;
  return source.city.endsWith("구") ? "같은 구" : source.city.endsWith("군") ? "같은 군" : "같은 시";
}
