export const DUPLICATE_PHONE_PROVIDER_ERROR = "PHONE_ALREADY_VERIFIED_BY_ANOTHER_USER";
export const DUPLICATE_PHONE_NOTICE_PROVIDER = "solapi_duplicate_phone_notice";
export const DUPLICATE_PHONE_NOTICE_DELAY_MS = 2 * 60 * 1000;
export const DUPLICATE_PHONE_NOTICE_COOLDOWN_MS = 24 * 60 * 60 * 1000;

export const DUPLICATE_PHONE_NOTICE_TEXT =
  "[짐툴] 이 번호로 가입된 계정이 있어요. 본인이 요청했다면 계정 찾기를 이용해주세요. 본인이 아니라면 무시해주세요.\nhttps://helchang.com/account-recovery";

export type DuplicatePhoneNoticeStatus = "pending" | "processing" | "sent" | "suppressed" | "failed";

export function buildDuplicatePhoneNoticeMeta(ownerUserId: string, nowMs = Date.now()) {
  return {
    duplicate_notice_status: "pending" as const,
    duplicate_notice_delay_seconds: DUPLICATE_PHONE_NOTICE_DELAY_MS / 1000,
    duplicate_notice_scheduled_for: new Date(nowMs + DUPLICATE_PHONE_NOTICE_DELAY_MS).toISOString(),
    duplicate_phone_owner_user_id: ownerUserId,
  };
}

export function readDuplicatePhoneOwnerUserId(meta: unknown) {
  if (!meta || typeof meta !== "object") return null;
  const ownerUserId = String((meta as Record<string, unknown>).duplicate_phone_owner_user_id ?? "").trim();
  return ownerUserId || null;
}

export function isDuplicatePhoneNoticeDue(meta: unknown, nowMs = Date.now()) {
  if (!meta || typeof meta !== "object") return false;
  const scheduledFor = String((meta as Record<string, unknown>).duplicate_notice_scheduled_for ?? "").trim();
  const scheduledMs = Date.parse(scheduledFor);
  return Number.isFinite(scheduledMs) && scheduledMs <= nowMs;
}

export function withDuplicatePhoneNoticeStatus(
  meta: unknown,
  status: DuplicatePhoneNoticeStatus,
  details: Record<string, unknown> = {},
) {
  const current = meta && typeof meta === "object" ? (meta as Record<string, unknown>) : {};
  return {
    ...current,
    duplicate_notice_status: status,
    duplicate_notice_updated_at: new Date().toISOString(),
    ...details,
  };
}
