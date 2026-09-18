const PREFIX = "gymtools:dating-onboarding-draft:v1:";
export const DRAFT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const TEXT_LIMITS = {
  nickname: 12, name: 30, birthYear: 4, heightCm: 3, job: 80, region: 80,
  introText: 2000, strengthsText: 1000, preferredPartnerText: 1000,
  trainingYears: 2, instagramId: 30, total3Lift: 4,
} as const;
export type DraftFields = Record<keyof typeof TEXT_LIMITS, string> & {
  sex: "male" | "female" | null;
  smoking: "non_smoker" | "occasional" | "smoker";
  workoutFrequency: string;
  photoVisibility: "blur" | "public";
};
export type DatingDraft = {
  version: 1;
  userId: string;
  savedAt: number;
  step: number;
  targets: { open: boolean; oneOnOne: boolean };
  fields: DraftFields;
};
type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem" | "key" | "length">;

function browserStorage(): StorageLike | null {
  try { return typeof window === "undefined" ? null : window.localStorage; } catch { return null; }
}

/** Explicit allowlist: no files, upload paths, consent or server registration state. */
export function sanitizeDraft(value: unknown, userId: string, now = Date.now()): DatingDraft | null {
  if (!value || typeof value !== "object" || !userId) return null;
  const raw = value as Partial<DatingDraft>;
  if (raw.version !== 1 || raw.userId !== userId || typeof raw.savedAt !== "number" ||
    !Number.isFinite(raw.savedAt) || raw.savedAt > now + 60_000 || now - raw.savedAt >= DRAFT_TTL_MS ||
    !raw.fields || typeof raw.fields !== "object" || !raw.targets || typeof raw.targets !== "object") return null;
  const input = raw.fields;
  const fields = {} as DraftFields;
  for (const key of Object.keys(TEXT_LIMITS) as (keyof typeof TEXT_LIMITS)[]) {
    fields[key] = typeof input[key] === "string" ? input[key].slice(0, TEXT_LIMITS[key]) : "";
  }
  fields.sex = input.sex === "male" || input.sex === "female" ? input.sex : null;
  fields.smoking = input.smoking === "smoker" || input.smoking === "occasional" ? input.smoking : "non_smoker";
  fields.workoutFrequency = ["none", "1_2", "3_4", "5_plus"].includes(input.workoutFrequency) ? input.workoutFrequency : "";
  fields.photoVisibility = input.photoVisibility === "public" ? "public" : "blur";
  return {
    version: 1, userId, savedAt: raw.savedAt,
    step: typeof raw.step === "number" && Number.isInteger(raw.step) ? Math.max(0, Math.min(3, raw.step)) : 0,
    targets: { open: raw.targets.open === true, oneOnOne: raw.targets.oneOnOne === true }, fields,
  };
}

export function hasDraftContent(fields: DraftFields) {
  return fields.sex !== null || Object.keys(TEXT_LIMITS).some((key) => key !== "nickname" && fields[key as keyof typeof TEXT_LIMITS].trim() !== "") ||
    fields.workoutFrequency !== "" || fields.smoking !== "non_smoker" || fields.photoVisibility !== "blur";
}

export function clearDatingDraft(userId?: string, storage = browserStorage()) {
  if (!storage) return;
  try {
    if (userId) storage.removeItem(PREFIX + userId);
    else {
      const keys = Array.from({ length: storage.length }, (_, i) => storage.key(i));
      for (const key of keys) if (key?.startsWith(PREFIX)) storage.removeItem(key);
    }
  } catch { /* Storage denial must not prevent logout or registration. */ }
}

export function readDatingDraft(userId: string, storage = browserStorage(), now = Date.now()): DatingDraft | null {
  if (!storage || !userId) return null;
  try {
    const keys = Array.from({ length: storage.length }, (_, i) => storage.key(i));
    for (const key of keys) if (key?.startsWith(PREFIX) && key !== PREFIX + userId) storage.removeItem(key);
    const text = storage.getItem(PREFIX + userId);
    if (!text) return null;
    const draft = text.length <= 40_000 ? sanitizeDraft(JSON.parse(text), userId, now) : null;
    if (!draft) clearDatingDraft(userId, storage);
    return draft;
  } catch { clearDatingDraft(userId, storage); return null; }
}

export function writeDatingDraft(draft: DatingDraft, storage = browserStorage()): boolean {
  if (!storage) return false;
  try {
    const safe = sanitizeDraft(draft, draft.userId);
    if (!safe) return false;
    if (!hasDraftContent(safe.fields)) clearDatingDraft(draft.userId, storage);
    else storage.setItem(PREFIX + draft.userId, JSON.stringify(safe));
    return true;
  } catch { return false; }
}
