import { validateNickname } from "@/lib/nickname";
import type { DraftFields } from "@/lib/dating-onboarding-draft";

export type ConsentKey = "consentOpenCard" | "consentFakeInfo" | "consentNoShow" | "consentFee" | "consentNoDirectContact" | "consentPrivacy";
export type OnboardingField = keyof DraftFields | ConsentKey | "targets" | "photo0" | "photo1";
export type OnboardingErrors = Partial<Record<OnboardingField, string>>;
export type ValidationInput = {
  fields: DraftFields;
  targets: { open: boolean; oneOnOne: boolean };
  selectedCount: number;
  nicknameSaved: boolean;
  maxBirthYear: number;
  photos: string[];
  consents: Record<ConsentKey, boolean>;
};

/** Mirrors the existing registration rules; only the error presentation changes. */
export function validateOnboardingStep(step: number, input: ValidationInput): OnboardingErrors {
  const { fields: f, targets, consents } = input;
  const errors: OnboardingErrors = {};
  if (!input.selectedCount) errors.targets = "등록할 서비스를 하나 이상 선택해 주세요.";
  if (step === 0) {
    if (!input.nicknameSaved) {
      const message = validateNickname(f.nickname);
      if (message) errors.nickname = message;
    }
    if (!f.sex) errors.sex = "성별을 선택해 주세요.";
    if (targets.oneOnOne && !f.name.trim()) errors.name = "1:1 신청서에 사용할 이름을 입력해 주세요.";
    if (targets.oneOnOne && f.name.trim().length > 30) errors.name = "이름은 30자 이하로 입력해 주세요.";
    const year = Number(f.birthYear);
    if (!Number.isInteger(year) || year < 1960 || year > input.maxBirthYear) errors.birthYear = "만 18세 이상만 이용할 수 있어요. 출생연도 4자리를 입력해 주세요. 예: 1996";
    const height = Number(f.heightCm);
    if (!Number.isInteger(height) || height < 120 || height > 230) errors.heightCm = "키는 120~230cm 사이로 입력해 주세요.";
    if (!f.job.trim()) errors.job = "직업을 입력해 주세요.";
    if (!f.region.trim()) errors.region = "지역을 입력해 주세요.";
    if (targets.open && f.job.trim().length > 50) errors.job = "오픈카드 직업은 50자 이하로 입력해 주세요.";
    else if (targets.oneOnOne && f.job.trim().length > 80) errors.job = "직업은 80자 이하로 입력해 주세요.";
    if (targets.open && f.region.trim().length > 30) errors.region = "오픈카드 지역은 30자 이하로 입력해 주세요.";
    else if (targets.oneOnOne && f.region.trim().length > 80) errors.region = "지역은 80자 이하로 입력해 주세요.";
  }
  if (step === 1) {
    if (targets.oneOnOne && !f.introText.trim()) errors.introText = "자기소개를 입력해 주세요.";
    if (targets.oneOnOne && f.introText.trim().length > 2000) errors.introText = "자기소개는 2,000자 이하로 입력해 주세요.";
    if (!f.strengthsText.trim()) errors.strengthsText = "내 강점을 입력해 주세요.";
    if (targets.open && f.strengthsText.trim().length > 150) errors.strengthsText = "오픈카드 내 강점은 150자 이하로 입력해 주세요.";
    else if (targets.oneOnOne && f.strengthsText.trim().length > 1000) errors.strengthsText = "내 강점은 1,000자 이하로 입력해 주세요.";
    if (!f.preferredPartnerText.trim()) errors.preferredPartnerText = "원하는 상대에 대한 내용을 입력해 주세요.";
    if (f.preferredPartnerText.trim().length > 1000) errors.preferredPartnerText = "원하는 상대는 1,000자 이하로 입력해 주세요.";
  }
  if (step === 2 && targets.open) {
    const years = f.trainingYears ? Number(f.trainingYears) : 0;
    if (!Number.isFinite(years) || years < 0 || years > 50) errors.trainingYears = "운동 경력은 0~50년 사이로 입력해 주세요.";
    const instagram = f.instagramId.trim().replace(/^@+/, "").replace(/\s+/g, "").slice(0, 30);
    if (!/^[A-Za-z0-9._]{1,30}$/.test(instagram)) errors.instagramId = "인스타그램 아이디를 @ 없이 정확히 입력해 주세요.";
  }
  if (step === 3) {
    if (input.photos[0]) errors.photo0 = input.photos[0];
    if (input.photos[1]) errors.photo1 = input.photos[1];
  }
  if (step === 4) {
    if (targets.open && !consents.consentOpenCard) errors.consentOpenCard = "오픈카드 공개 범위 안내를 확인해 주세요.";
    if (targets.oneOnOne) {
      for (const key of ["consentFakeInfo", "consentNoShow", "consentFee", "consentNoDirectContact", "consentPrivacy"] as const) {
        if (!consents[key]) errors[key] = "필수 확인 항목에 동의해 주세요.";
      }
    }
  }
  return errors;
}

export const onboardingFieldId = (field: string) => `onboarding-field-${field}`;
