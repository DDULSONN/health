export const OPEN_QUICK_PASS = {
  priceKrw: 30_000,
  durationDays: 30,
  instantPublishes: 4,
  instantCooldownDays: 7,
  extraApplications: 40,
  dailyLikes: 50,
  maxPreferredAreas: 2,
} as const;

const DAY_MS = 86_400_000;
const KOREA_OFFSET_MS = 9 * 60 * 60 * 1_000;
const TERM_MS = OPEN_QUICK_PASS.durationDays * DAY_MS;
const INSTANT_COOLDOWN_MS = OPEN_QUICK_PASS.instantCooldownDays * DAY_MS;
const MAX_TIMESTAMP = 8_640_000_000_000_000;

type InstantPublication = Readonly<{ id: string; atMs: number }>;
type SentLike = Readonly<{ cardId: string; day: number }>;

/** In-memory preview state, not a source of production entitlements. */
export type OpenQuickPassState = Readonly<{
  activatedAtMs: number;
  lastUpdatedAtMs: number;
  instantPublications: readonly InstantPublication[];
  appliedCardIds: readonly string[];
  sentLikes: readonly SentLike[];
  preferredAreas: readonly string[];
}>;

export type OpenQuickPassAction =
  | { type: "record-instant-publish"; publicationId: string; published: boolean; alreadyHasVisibleCard?: boolean }
  | { type: "record-application"; cardId: string; submitted: boolean }
  | { type: "record-like"; cardId: string; sent: boolean }
  | { type: "set-preferred-areas"; areas: readonly string[] };

export type OpenQuickPassOutcome =
  | "applied"
  | "inactive"
  | "invalid"
  | "not-completed"
  | "duplicate"
  | "limit"
  | "cooldown"
  | "visible-card";

export type OpenQuickPassNearbyCard = Readonly<{
  id: string;
  area: string;
  status: "published" | "queued" | "hidden" | "rejected";
  registeredAtMs: number;
  publishedAtMs: number | null;
  expiresAtMs: number | null;
  /** The card is eligible for this viewer under the existing access and blocking policies. */
  canView: boolean;
}>;

function validTimestamp(ms: number) {
  return Number.isSafeInteger(ms) && ms >= 0 && ms <= MAX_TIMESTAMP;
}

function getKoreaDay(ms: number) {
  return Math.floor((ms + KOREA_OFFSET_MS) / DAY_MS);
}

export function createOpenQuickPass(activatedAtMs: number): OpenQuickPassState {
  if (!validTimestamp(activatedAtMs) || activatedAtMs + TERM_MS > MAX_TIMESTAMP) {
    throw new RangeError("Invalid pass activation timestamp");
  }

  return {
    activatedAtMs,
    lastUpdatedAtMs: activatedAtMs,
    instantPublications: [],
    appliedCardIds: [],
    sentLikes: [],
    preferredAreas: [],
  };
}

export function getOpenQuickPassBenefits(state: OpenQuickPassState, nowMs: number) {
  const expiresAtMs = state.activatedAtMs + TERM_MS;
  const active = validTimestamp(nowMs) && nowMs >= state.activatedAtMs && nowMs < expiresAtMs;
  const instantRemaining = active ? Math.max(0, OPEN_QUICK_PASS.instantPublishes - state.instantPublications.length) : 0;
  const lastPublish = state.instantPublications[state.instantPublications.length - 1];
  const nextPublishAt = lastPublish ? lastPublish.atMs + INSTANT_COOLDOWN_MS : state.activatedAtMs;
  const likesToday = active ? state.sentLikes.filter((like) => like.day === getKoreaDay(nowMs)).length : 0;

  return {
    active,
    expiresAtMs,
    instantRemaining,
    nextInstantPublishAtMs:
      instantRemaining > 0 && nextPublishAt > nowMs && nextPublishAt < expiresAtMs ? nextPublishAt : null,
    canInstantPublish: instantRemaining > 0 && nowMs >= nextPublishAt,
    extraApplicationsRemaining: active ? Math.max(0, OPEN_QUICK_PASS.extraApplications - state.appliedCardIds.length) : 0,
    likesRemaining: active ? Math.max(0, OPEN_QUICK_PASS.dailyLikes - likesToday) : 0,
    preferredAreas: active ? state.preferredAreas : [],
  };
}

export function updateOpenQuickPass(
  state: OpenQuickPassState,
  action: OpenQuickPassAction,
  nowMs: number,
): { state: OpenQuickPassState; outcome: OpenQuickPassOutcome } {
  const keep = (outcome: OpenQuickPassOutcome) => ({ state, outcome });
  const apply = (change: Partial<OpenQuickPassState>) => ({
    state: { ...state, ...change, lastUpdatedAtMs: nowMs },
    outcome: "applied" as const,
  });
  if (!validTimestamp(nowMs)) return keep("invalid");
  const benefits = getOpenQuickPassBenefits(state, nowMs);
  if (!benefits.active) return keep("inactive");
  if (nowMs < state.lastUpdatedAtMs) return keep("invalid");

  switch (action.type) {
    case "record-instant-publish": {
      const id = action.publicationId.trim();
      if (!id) return keep("invalid");
      if (state.instantPublications.some((publication) => publication.id === id)) return keep("duplicate");
      if (action.alreadyHasVisibleCard) return keep("visible-card");
      if (!action.published) return keep("not-completed");
      if (benefits.instantRemaining === 0) return keep("limit");
      if (!benefits.canInstantPublish) return keep("cooldown");
      return apply({ instantPublications: [...state.instantPublications, { id, atMs: nowMs }] });
    }
    case "record-application": {
      const id = action.cardId.trim();
      if (!id) return keep("invalid");
      if (state.appliedCardIds.includes(id)) return keep("duplicate");
      if (!action.submitted) return keep("not-completed");
      if (benefits.extraApplicationsRemaining === 0) return keep("limit");
      return apply({ appliedCardIds: [...state.appliedCardIds, id] });
    }
    case "record-like": {
      const cardId = action.cardId.trim();
      if (!cardId) return keep("invalid");
      if (state.sentLikes.some((like) => like.cardId === cardId)) return keep("duplicate");
      if (!action.sent) return keep("not-completed");
      if (benefits.likesRemaining === 0) return keep("limit");
      return apply({ sentLikes: [...state.sentLikes, { cardId, day: getKoreaDay(nowMs) }] });
    }
    case "set-preferred-areas": {
      const preferredAreas = action.areas.map((area) => area.trim());
      if (preferredAreas.length > OPEN_QUICK_PASS.maxPreferredAreas) return keep("limit");
      if (preferredAreas.some((area) => !area) || new Set(preferredAreas).size !== preferredAreas.length) {
        return keep("invalid");
      }
      return apply({ preferredAreas });
    }
  }
}

export function getOpenQuickPassNearbyCards<T extends OpenQuickPassNearbyCard>(
  state: OpenQuickPassState,
  cards: readonly T[],
  nowMs: number,
): T[] {
  const { active, preferredAreas } = getOpenQuickPassBenefits(state, nowMs);
  if (!active || preferredAreas.length === 0) return [];

  // A nearby pass shows eligible queued cards without changing their visibility outside this list.
  const orderTime = (card: T) => card.status === "queued" ? card.registeredAtMs : card.publishedAtMs ?? 0;
  return cards
    .filter((card) => {
      if (card.canView !== true || !preferredAreas.includes(card.area)) return false;
      if (!validTimestamp(card.registeredAtMs) || card.registeredAtMs > nowMs) return false;
      const hasLiveExpiry = card.expiresAtMs !== null && validTimestamp(card.expiresAtMs) && nowMs < card.expiresAtMs;
      if (card.status === "queued") return card.publishedAtMs === null && (card.expiresAtMs === null || hasLiveExpiry);
      return card.status === "published" &&
        card.publishedAtMs !== null && validTimestamp(card.publishedAtMs) &&
        card.registeredAtMs <= card.publishedAtMs && card.publishedAtMs <= nowMs && hasLiveExpiry;
    })
    .sort((a, b) => Number(b.status === "queued") - Number(a.status === "queued") || orderTime(b) - orderTime(a));
}
