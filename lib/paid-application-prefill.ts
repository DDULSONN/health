// Only copy editable profile fields. Never carry storage paths, consent, or ownership into a submission.
export function paidApplicationPrefill(value: unknown) {
  const card = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const text = (key: string, max: number) => typeof card[key] === "string" ? card[key].trim().slice(0, max) : "";
  const number = (key: string, min: number, max: number) => {
    const value = card[key];
    return typeof value === "number" && Number.isFinite(value) && Number.isInteger(value) && value >= min && value <= max
      ? String(value) : "";
  };
  return {
    age: number("age", 19, 99),
    heightCm: number("height_cm", 120, 230),
    region: text("region", 30),
    job: text("job", 50),
    trainingYears: number("training_years", 0, 50),
    instagramId: text("instagram_id", 40).replace(/^@+/, "").replace(/\s+/g, "").slice(0, 30),
    introText: [text("strengths_text", 1000), text("ideal_type", 1000)].filter(Boolean).join("\n\n").slice(0, 1000),
    photoUrls: Array.from({ length: 2 }, (_, slot) =>
      Array.isArray(card.photo_preview_urls) && typeof card.photo_preview_urls[slot] === "string" ? card.photo_preview_urls[slot] : ""),
  };
}

export function canOfferInstantOpenCard(pending: boolean, state: {
  ready: boolean; loading: boolean; error: unknown;
  card: { status: string } | null; presentation: { active: boolean; label?: string } | null;
}) {
  return pending && state.ready && !state.loading && !state.error && !state.presentation?.active &&
    (!state.card || ["expired", "rejected"].includes(state.card.status) ||
      (state.card.status === "approved" && state.presentation?.label === "공개 종료"));
}
