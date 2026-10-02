import type { DraftFields } from "@/lib/dating-onboarding-draft";

export const ONE_ON_ONE_ONBOARDING_HREF = "/onboarding/dating?target=one_on_one";
export type OnboardingEntry = "combined" | "one_on_one" | "instant_open_card";
type Targets = { open: boolean; oneOnOne: boolean };

export function onboardingEntry(search: string): OnboardingEntry {
  const params = new URLSearchParams(search);
  // The existing paid-registration return flow always takes precedence.
  if (params.get("next") === "instant_open_card") return "instant_open_card";
  return params.get("target") === "one_on_one" ? "one_on_one" : "combined";
}

export function onboardingEntryHref(entry: OnboardingEntry) {
  return entry === "instant_open_card" ? "/onboarding/dating?next=instant_open_card"
    : entry === "one_on_one" ? ONE_ON_ONE_ONBOARDING_HREF : "/onboarding/dating";
}

export function onboardingTargets(entry: OnboardingEntry, available: Targets, saved?: Targets): Targets {
  if (entry === "instant_open_card") return { open: available.open, oneOnOne: false };
  if (entry === "one_on_one") return { open: false, oneOnOne: available.oneOnOne };
  const selected = saved ? { open: available.open && saved.open, oneOnOne: available.oneOnOne && saved.oneOnOne } : available;
  return selected.open || selected.oneOnOne ? { ...selected } : { ...available };
}

export type ReusableOpenCard = Record<string, unknown> & { id: string; owner_user_id: string };
export function pickOwnOpenCard(items: unknown, userId: string): ReusableOpenCard | null {
  if (!userId || !Array.isArray(items)) return null;
  const cards = items.filter((item): item is ReusableOpenCard => Boolean(item && typeof item === "object" &&
    typeof item.id === "string" && item.id && item.owner_user_id === userId &&
    ["pending", "public", "hidden", "expired"].includes(item.status)));
  // The owner endpoint already sorts newest first. Prefer a currently registered card.
  return cards.find(card => card.status === "pending" || card.status === "public") ?? cards[0] ?? null;
}

export function openCardPrefill(card: ReusableOpenCard): Partial<DraftFields> {
  const fields: Partial<DraftFields> = {};
  if (card.sex === "male" || card.sex === "female") fields.sex = card.sex;
  if (typeof card.height_cm === "number" && Number.isInteger(card.height_cm) && card.height_cm >= 120 && card.height_cm <= 230) {
    fields.heightCm = String(card.height_cm);
  }
  for (const [source, target, max] of [
    ["region", "region", 80], ["job", "job", 80],
    ["strengths_text", "strengthsText", 1000], ["ideal_type", "preferredPartnerText", 1000],
  ] as const) {
    const value = card[source];
    if (typeof value === "string" && value.trim() && value.trim().length <= max) fields[target] = value.trim();
  }
  // Do not infer a birth year from a potentially stale age or a real name from a nickname.
  // Contacts, consents, public-photo preference and registration state are never imported.
  return fields;
}
