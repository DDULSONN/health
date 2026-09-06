export type ApplyCheckoutDraft = {
  age: string; heightCm: string; region: string; job: string; trainingYears: string;
  introText: string; instagramId: string; photoPaths: string[];
};
const fields = ["age", "heightCm", "region", "job", "trainingYears", "introText", "instagramId"] as const;
const key = (userId: string, cardId: string) => `dating-apply-checkout:v1:${userId}:${cardId}`;
export function saveApplyCheckoutDraft(storage: Storage, userId: string, cardId: string, draft: ApplyCheckoutDraft) {
  storage.setItem(key(userId, cardId), JSON.stringify({ ...draft, savedAt: Date.now() }));
}
export function readApplyCheckoutDraft(storage: Storage, userId: string, cardId: string): ApplyCheckoutDraft | null {
  try {
    const draft = JSON.parse(storage.getItem(key(userId, cardId)) ?? "null");
    if (!draft || typeof draft.savedAt !== "number" || Date.now() - draft.savedAt > 60 * 60 * 1000 || draft.savedAt > Date.now()) {
      storage.removeItem(key(userId, cardId));
      return null;
    }
    if (!fields.every((field) => typeof draft[field] === "string" && draft[field].length <= 1000) ||
      !Array.isArray(draft.photoPaths) || draft.photoPaths.length > 2 || !draft.photoPaths.every((path: unknown) => typeof path === "string")) return null;
    return draft;
  } catch { return null; }
}
export function clearApplyCheckoutDraft(storage: Storage, userId: string, cardId: string) {
  storage.removeItem(key(userId, cardId));
}
