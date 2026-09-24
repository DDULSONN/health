import { hasDraftContent, type DatingDraft } from "@/lib/dating-onboarding-draft";

export type DatingDraftResume = Pick<DatingDraft, "userId" | "savedAt" | "step" | "targets">;
const STEP_LABELS = ["기본 정보", "내 소개", "생활 정보", "사진 등록"] as const;

/** The home hint carries no member-written text, files, consent or completion claims. */
export function summarizeDatingDraft(draft: DatingDraft | null): DatingDraftResume | null {
  if (!draft || !hasDraftContent(draft.fields) || (!draft.targets.open && !draft.targets.oneOnOne)) return null;
  return { userId: draft.userId, savedAt: draft.savedAt, step: draft.step, targets: { ...draft.targets } };
}

export function canResumeDatingDraft(draft: DatingDraftResume | null, registered: { open: boolean; oneOnOne: boolean }) {
  return Boolean(draft && ((draft.targets.open && !registered.open) || (draft.targets.oneOnOne && !registered.oneOnOne)));
}

export function datingDraftStepLabel(step: number) {
  return STEP_LABELS[step] ?? STEP_LABELS[0];
}
