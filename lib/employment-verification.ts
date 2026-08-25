import type { User } from "@supabase/supabase-js";
import crypto from "crypto";

export const EMPLOYMENT_VERIFICATION_KEY = "employment_verification";
export const EMPLOYMENT_CHALLENGE_KEY = "employment_verification_challenge";
export const EMPLOYMENT_OTP_TTL_SECONDS = 10 * 60;
export const EMPLOYMENT_RESEND_SECONDS = 60;

const PERSONAL_EMAIL_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "naver.com",
  "daum.net",
  "hanmail.net",
  "kakao.com",
  "nate.com",
  "hotmail.com",
  "outlook.com",
  "live.com",
  "msn.com",
  "icloud.com",
  "me.com",
  "yahoo.com",
  "yahoo.co.kr",
  "proton.me",
  "protonmail.com",
  "pm.me",
  "fastmail.com",
  "hey.com",
  "mail.com",
  "gmx.com",
  "gmx.net",
  "aol.com",
  "yandex.com",
  "zoho.com",
]);

const DISPOSABLE_EMAIL_DOMAINS = new Set([
  "10minutemail.com",
  "guerrillamail.com",
  "mailinator.com",
  "temp-mail.org",
  "tempmail.com",
  "yopmail.com",
]);

export type EmploymentVerification = {
  id: string;
  user_id: string;
  company_name: string;
  email_domain: string;
  email_hash?: string | null;
  status: "verified" | "revoked";
  verification_method: "admin_manual" | "work_email";
  verified_at: string;
  expires_at: string;
  verified_by_user_id: string | null;
  revoked_at: string | null;
  revoked_by_user_id: string | null;
  revoke_reason: string | null;
  created_at: string;
  updated_at: string;
};

export type EmploymentChallenge = {
  id: string;
  user_id: string;
  company_name: string;
  email_domain: string;
  email_hash: string;
  masked_email: string;
  code_hash: string;
  sent_at: string;
  expires_at: string;
};

function employmentSecret() {
  return (
    process.env.EMPLOYMENT_VERIFICATION_SECRET?.trim() ||
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ||
    process.env.RESEND_API_KEY?.trim() ||
    "local-employment-verification-secret"
  );
}

export function normalizeCompanyName(value: unknown) {
  return typeof value === "string" ? value.trim().replace(/\s{2,}/g, " ").slice(0, 80) : "";
}

export function normalizeEmailDomain(value: unknown) {
  if (typeof value !== "string") return "";
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .split(/[/?#]/)[0]
    .replace(/^@+/, "");
  return (normalized.split("@").pop() ?? "").replace(/\.+$/, "");
}

export function isValidCompanyDomain(domain: string) {
  const isBlocked = [...PERSONAL_EMAIL_DOMAINS, ...DISPOSABLE_EMAIL_DOMAINS].some(
    (blockedDomain) => domain === blockedDomain || domain.endsWith(`.${blockedDomain}`)
  );
  if (domain.length < 3 || domain.length > 253 || isBlocked) return false;
  return /^(?=.{3,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i.test(domain);
}

export function normalizeWorkEmail(value: unknown) {
  if (typeof value !== "string") return "";
  return value.trim().toLowerCase().slice(0, 254);
}

export function validateWorkEmail(value: unknown) {
  const email = normalizeWorkEmail(value);
  if (!/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i.test(email)) {
    return { ok: false as const, email, domain: "", error: "올바른 직장 이메일 주소를 입력해주세요." };
  }
  const domain = normalizeEmailDomain(email);
  if (!isValidCompanyDomain(domain)) {
    return {
      ok: false as const,
      email,
      domain,
      error: "Gmail·네이버 등 개인 메일은 사용할 수 없습니다. 회사에서 발급한 이메일을 입력해주세요.",
    };
  }
  return { ok: true as const, email, domain };
}

export function maskWorkEmail(email: string) {
  const [local, domain] = email.split("@");
  const visible = local.length <= 2 ? local.slice(0, 1) : local.slice(0, 2);
  return `${visible}${"*".repeat(Math.max(3, Math.min(8, local.length - visible.length)))}@${domain}`;
}

export function hashWorkEmail(email: string) {
  return crypto.createHmac("sha256", employmentSecret()).update(`email:${normalizeWorkEmail(email)}`).digest("hex");
}

export function createEmploymentOtp(input: { userId: string; email: string; companyName: string }) {
  const code = crypto.randomInt(100000, 1000000).toString();
  const id = crypto.randomUUID();
  const sentAt = new Date();
  const expiresAt = new Date(sentAt.getTime() + EMPLOYMENT_OTP_TTL_SECONDS * 1000);
  const emailHash = hashWorkEmail(input.email);
  const codeHash = crypto
    .createHmac("sha256", employmentSecret())
    .update(`otp:${id}:${input.userId}:${emailHash}:${code}`)
    .digest("hex");
  const challenge: EmploymentChallenge = {
    id,
    user_id: input.userId,
    company_name: input.companyName,
    email_domain: normalizeEmailDomain(input.email),
    email_hash: emailHash,
    masked_email: maskWorkEmail(input.email),
    code_hash: codeHash,
    sent_at: sentAt.toISOString(),
    expires_at: expiresAt.toISOString(),
  };
  return { code, challenge };
}

export function verifyEmploymentOtp(challenge: EmploymentChallenge, userId: string, code: string) {
  const candidate = crypto
    .createHmac("sha256", employmentSecret())
    .update(`otp:${challenge.id}:${userId}:${challenge.email_hash}:${code}`)
    .digest("hex");
  try {
    return crypto.timingSafeEqual(Buffer.from(candidate, "hex"), Buffer.from(challenge.code_hash, "hex"));
  } catch {
    return false;
  }
}

export function readEmploymentVerification(user: User): EmploymentVerification | null {
  const raw = user.app_metadata?.[EMPLOYMENT_VERIFICATION_KEY];
  if (!raw || typeof raw !== "object") return null;
  const item = raw as Partial<EmploymentVerification>;
  if (
    typeof item.id !== "string" ||
    typeof item.user_id !== "string" ||
    typeof item.company_name !== "string" ||
    typeof item.email_domain !== "string" ||
    (item.status !== "verified" && item.status !== "revoked") ||
    typeof item.verified_at !== "string" ||
    typeof item.expires_at !== "string" ||
    typeof item.created_at !== "string" ||
    typeof item.updated_at !== "string"
  ) {
    return null;
  }
  return {
    id: item.id,
    user_id: item.user_id,
    company_name: item.company_name,
    email_domain: item.email_domain,
    email_hash: typeof item.email_hash === "string" ? item.email_hash : null,
    status: item.status,
    verification_method: item.verification_method === "work_email" ? "work_email" : "admin_manual",
    verified_at: item.verified_at,
    expires_at: item.expires_at,
    verified_by_user_id: item.verified_by_user_id ?? null,
    revoked_at: item.revoked_at ?? null,
    revoked_by_user_id: item.revoked_by_user_id ?? null,
    revoke_reason: item.revoke_reason ?? null,
    created_at: item.created_at,
    updated_at: item.updated_at,
  };
}

export function readEmploymentChallenge(user: User): EmploymentChallenge | null {
  const raw = user.app_metadata?.[EMPLOYMENT_CHALLENGE_KEY];
  if (!raw || typeof raw !== "object") return null;
  const item = raw as Partial<EmploymentChallenge>;
  if (
    typeof item.id !== "string" ||
    item.user_id !== user.id ||
    typeof item.company_name !== "string" ||
    typeof item.email_domain !== "string" ||
    typeof item.email_hash !== "string" ||
    typeof item.masked_email !== "string" ||
    typeof item.code_hash !== "string" ||
    typeof item.sent_at !== "string" ||
    typeof item.expires_at !== "string"
  ) {
    return null;
  }
  return item as EmploymentChallenge;
}

export function withEmploymentEffectiveStatus(verification: EmploymentVerification | null) {
  if (!verification) return null;
  const effectiveStatus =
    verification.status === "revoked"
      ? "revoked"
      : new Date(verification.expires_at).getTime() > Date.now()
        ? "verified"
        : "expired";
  return { ...verification, effective_status: effectiveStatus as "verified" | "revoked" | "expired" };
}

export function serializeEmploymentVerification(verification: EmploymentVerification | null) {
  const effective = withEmploymentEffectiveStatus(verification);
  if (!effective) return null;
  const copy = { ...effective };
  delete copy.email_hash;
  return copy;
}

export function addEmploymentValidityMonths(months: number) {
  const date = new Date();
  date.setUTCMonth(date.getUTCMonth() + months);
  return date.toISOString();
}
