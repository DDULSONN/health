// The 48-hour notice starts with the policy, not with each visitor or deployment.
export const CONTACT_CARE_NOTICE_ID = "contact-care-launch-v1";
export const CONTACT_CARE_HREF = "/mypage?section=matching&match=one_on_one&care=1#contact-care";
export const CONTACT_CARE_NOTICE_TITLE = "번호교환 후 연락이 닿지 않을 때";
export const CONTACT_CARE_NOTICE_MESSAGE = "교환 후 첫 연락에 답이 없다면, 3일 이내에 대화 캡처와 함께 알려주세요. 관리자가 확인 후 지원 대상에 해당하면 다음 1:1 번호교환권 1장을 드려요.";
export type ContactCarePublicPolicy = { active: boolean; startsAt: string | null; endsAt: string | null };

export function contactCarePublicPolicy(enabled: unknown, startsAt: unknown, now = Date.now()): ContactCarePublicPolicy {
  const starts = typeof startsAt === "string" ? Date.parse(startsAt) : NaN;
  if (enabled !== true || !Number.isFinite(starts) || starts > now) return { active: false, startsAt: null, endsAt: null };
  return { active: true, startsAt: new Date(starts).toISOString(), endsAt: new Date(starts + 48 * 3600000).toISOString() };
}

export function isContactCareNoticeActive(policy: ContactCarePublicPolicy | null, now = Date.now()) {
  return !!policy?.active && now >= Date.parse(policy.startsAt || "") && now < Date.parse(policy.endsAt || "");
}

export function contactCareNoticePathAllowed(path: string) {
  return !/^\/(?:api|admin|payments|auth|login|signup|account-recovery|phone-verification|verify-email|onboarding)(?:\/|$)/.test(path)
    && !/^\/mypage\/admin(?:\/|$)/.test(path) && path !== "/community/write"
    && !/\/(?:new|edit|apply)\/?$/.test(path);
}
