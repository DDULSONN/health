// Fixed codes only: never accept form values, contacts, URLs or error messages.
export const ONBOARDING_EVENTS = [
  "phone_view", "phone_send_failed", "phone_verify_failed", "phone_duplicate",
  "profile_basic", "profile_intro", "profile_lifestyle", "profile_photos", "profile_review",
  "validation_basic", "validation_intro", "validation_lifestyle", "validation_photos", "validation_review",
  "photo_rejected", "submit_started", "upload_failed", "submit_failed",
] as const;
export type OnboardingEvent = typeof ONBOARDING_EVENTS[number];
const allowedEvents = new Set<string>(ONBOARDING_EVENTS);
export const PROFILE_STAGE_EVENTS: OnboardingEvent[] = [
  "profile_basic", "profile_intro", "profile_lifestyle", "profile_photos", "profile_review",
];
export const VALIDATION_STAGE_EVENTS: OnboardingEvent[] = [
  "validation_basic", "validation_intro", "validation_lifestyle", "validation_photos", "validation_review",
];
export function isOnboardingEvent(value: unknown): value is OnboardingEvent {
  return typeof value === "string" && allowedEvents.has(value);
}
export function parseOnboardingEvent(body: unknown): OnboardingEvent | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  if (Object.keys(body).some((key) => key !== "event")) return null;
  const event = (body as { event?: unknown }).event;
  return isOnboardingEvent(event) ? event : null;
}
export const FUNNEL_STAGES = [
  ["joined", "가입 회원"],
  ["verified", "휴대폰 인증"],
  ["profile", "프로필 등록"],
  ["one_on_one", "1:1 프로필 등록"],
  ["mutual", "1:1 쌍방 수락"],
  ["exchanged", "연락처 교환 승인"],
] as const;
export type FunnelStage = typeof FUNNEL_STAGES[number][0];
export type OnboardingFunnelSummary = {
  cohort_start: string;
  measured_at: string;
  tracking_since: string;
  counts: Record<FunnelStage, number>;
  events: Partial<Record<OnboardingEvent, number>>;
  unregistered: Partial<Record<OnboardingEvent, number>>;
};
export function isFunnelSummary(value: unknown): value is OnboardingFunnelSummary {
  if (!value || typeof value !== "object") return false;
  const v = value as OnboardingFunnelSummary;
  if (![v.cohort_start, v.measured_at, v.tracking_since].every((date) => typeof date === "string" && Number.isFinite(Date.parse(date)))) return false;
  if (!v.counts || !v.events || !v.unregistered) return false;
  const validCount = (n: unknown) => typeof n === "number" && Number.isSafeInteger(n) && n >= 0;
  return FUNNEL_STAGES.every(([key]) => validCount(v.counts[key])) &&
    [v.events, v.unregistered].every((map) => !Array.isArray(map) && typeof map === "object" &&
      Object.entries(map).every(([key, n]) => isOnboardingEvent(key) && validCount(n)));
}
