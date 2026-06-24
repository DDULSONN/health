import { createHmac, randomInt } from "crypto";
import { SolapiMessageService } from "solapi";

const OTP_TTL_MINUTES = 10;

export type SolapiOtpRecord = {
  code: string;
  codeHash: string;
  expiresAt: string;
};

function getOtpHashSecret() {
  return (
    process.env.SOLAPI_OTP_HASH_SECRET?.trim() ||
    process.env.PHONE_VERIFICATION_SECRET?.trim() ||
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ||
    "local-phone-verification-secret"
  );
}

export function isSolapiPhoneOtpConfigured() {
  return Boolean(
    process.env.SOLAPI_API_KEY?.trim() &&
      process.env.SOLAPI_API_SECRET?.trim() &&
      process.env.SOLAPI_SENDER_NUMBER?.trim()
  );
}

export function shouldFallbackToSolapiPhoneOtp(message: string) {
  const lower = message.toLowerCase();
  if (lower.includes("already") && lower.includes("phone")) return false;
  if (lower.includes("invalid") && lower.includes("phone")) return false;
  return lower.includes("sms") || lower.includes("otp") || lower.includes("twilio") || lower.includes("provider");
}

export function normalizeSolapiKoreanPhoneNumber(phoneE164: string) {
  const digits = String(phoneE164 ?? "").replace(/\D/g, "");
  if (digits.startsWith("82")) return `0${digits.slice(2)}`;
  return digits;
}

export function createSolapiOtp(phoneE164: string, userId: string): SolapiOtpRecord {
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const expiresAt = new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000).toISOString();
  return {
    code,
    codeHash: hashSolapiOtp({ phoneE164, userId, code }),
    expiresAt,
  };
}

export function hashSolapiOtp(input: { phoneE164: string; userId: string; code: string }) {
  return createHmac("sha256", getOtpHashSecret())
    .update(`${input.userId}:${input.phoneE164}:${input.code}`)
    .digest("hex");
}

export async function sendSolapiPhoneOtp(input: { phoneE164: string; code: string }) {
  const apiKey = process.env.SOLAPI_API_KEY?.trim();
  const apiSecret = process.env.SOLAPI_API_SECRET?.trim();
  const sender = normalizeSolapiKoreanPhoneNumber(process.env.SOLAPI_SENDER_NUMBER ?? "");
  if (!apiKey || !apiSecret || !sender) {
    throw new Error("SOLAPI_NOT_CONFIGURED");
  }

  const messageService = new SolapiMessageService(apiKey, apiSecret);
  const to = normalizeSolapiKoreanPhoneNumber(input.phoneE164);
  await messageService.send({
    to,
    from: sender,
    text: `[짐틀] 휴대폰 인증번호는 ${input.code} 입니다. 10분 안에 입력해주세요.`,
  });
}
