import { createHmac, timingSafeEqual } from "crypto";
import type { NextResponse } from "next/server";
import { hashPhoneForVerificationStorage } from "@/lib/solapi-phone-verification";

export const ACCOUNT_RECOVERY_COOKIE = "gymtool_account_recovery";
export const ACCOUNT_RECOVERY_TTL_SECONDS = 30 * 60;

type RecoveryTicket = {
  phoneHash: string;
  expiresAt: number;
};

function getTicketSecret() {
  return (
    process.env.ACCOUNT_RECOVERY_SECRET?.trim() ||
    process.env.SOLAPI_OTP_HASH_SECRET?.trim() ||
    process.env.PHONE_VERIFICATION_SECRET?.trim() ||
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ||
    "local-account-recovery-secret"
  );
}

function sign(payload: string) {
  return createHmac("sha256", getTicketSecret()).update(payload).digest("base64url");
}

export function createAccountRecoveryTicket(phoneE164: string, nowMs = Date.now()) {
  const expiresAt = Math.floor(nowMs / 1000) + ACCOUNT_RECOVERY_TTL_SECONDS;
  const payload = `v1.${expiresAt}.${hashPhoneForVerificationStorage(phoneE164)}`;
  return `${payload}.${sign(payload)}`;
}

export function readAccountRecoveryTicket(value: string | undefined, nowMs = Date.now()): RecoveryTicket | null {
  const parts = String(value ?? "").split(".");
  if (parts.length !== 4 || parts[0] !== "v1") return null;

  const expiresAt = Number(parts[1]);
  const phoneHash = parts[2];
  const signature = parts[3];
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= Math.floor(nowMs / 1000)) return null;
  if (!/^[a-f0-9]{64}$/.test(phoneHash) || !/^[A-Za-z0-9_-]{43}$/.test(signature)) return null;

  const expected = sign(`v1.${expiresAt}.${phoneHash}`);
  const actualBuffer = Buffer.from(signature, "utf8");
  const expectedBuffer = Buffer.from(expected, "utf8");
  if (actualBuffer.length !== expectedBuffer.length || !timingSafeEqual(actualBuffer, expectedBuffer)) return null;

  return { phoneHash, expiresAt };
}

export function attachAccountRecoveryTicket(response: NextResponse, phoneE164: string) {
  response.cookies.set(ACCOUNT_RECOVERY_COOKIE, createAccountRecoveryTicket(phoneE164), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: ACCOUNT_RECOVERY_TTL_SECONDS,
  });
  return response;
}
