import { kvIncrWindow } from "@/lib/edge-kv";
import { getPhoneValidationMessage, hashForOperationalLog, normalizePhoneToE164 } from "@/lib/phone-verification";
import { extractClientIp } from "@/lib/request-rate-limit";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

const ATTEMPT_LOG_TABLE = "profile_phone_verification_attempts";

function mapVerifyErrorToUserMessage(message: string): string {
  const lower = message.toLowerCase();
  if (lower.includes("expired")) return "인증번호가 만료되었습니다. 다시 발송해 주세요.";
  if (lower.includes("invalid") || lower.includes("token") || lower.includes("otp")) {
    return "인증번호가 맞지 않습니다. 문자로 받은 최신 인증번호를 입력해 주세요.";
  }
  if (lower.includes("rate") || lower.includes("too many")) {
    return "확인 요청이 너무 잦습니다. 잠시 후 다시 시도해 주세요.";
  }
  return "인증번호 확인에 실패했습니다. 다시 시도해 주세요.";
}

async function logPhoneVerificationAttempt(input: {
  userId: string | null;
  phoneE164: string | null;
  status: "success" | "fail" | "blocked";
  requestId: string;
  ip: string;
  providerError?: string | null;
  retryAfterSec?: number | null;
  meta?: Record<string, unknown>;
}) {
  try {
    const admin = createAdminClient();
    const res = await admin.from(ATTEMPT_LOG_TABLE).insert({
      user_id: input.userId,
      phone_e164: input.phoneE164,
      phone_hash: input.phoneE164 ? hashForOperationalLog(input.phoneE164) : null,
      action: "verify",
      status: input.status,
      provider: "supabase_auth",
      provider_error: input.providerError ?? null,
      request_id: input.requestId,
      ip_hash: hashForOperationalLog(input.ip),
      retry_after_sec: input.retryAfterSec ?? null,
      meta: input.meta ?? {},
    });
    if (res.error && res.error.code !== "42P01") {
      console.warn("[phone-otp-verify] failed_to_insert_attempt_log", res.error.message);
    }
  } catch (error) {
    console.warn("[phone-otp-verify] attempt_log_unavailable", error);
  }
}

export async function POST(req: Request) {
  const requestId = crypto.randomUUID();
  const ip = extractClientIp(req);

  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
    }

    const body = (await req.json().catch(() => ({}))) as { phone?: string; token?: string };
    const phoneE164 = normalizePhoneToE164(body.phone ?? "");
    const token = String(body.token ?? "").trim();
    const validationMessage = getPhoneValidationMessage(phoneE164);

    if (validationMessage) {
      await logPhoneVerificationAttempt({
        userId: user.id,
        phoneE164: phoneE164 || null,
        status: "fail",
        requestId,
        ip,
        providerError: "INVALID_PHONE_FORMAT",
      });
      return NextResponse.json({ error: validationMessage, code: "INVALID_PHONE_FORMAT" }, { status: 400 });
    }

    if (!/^[0-9]{4,8}$/.test(token)) {
      await logPhoneVerificationAttempt({
        userId: user.id,
        phoneE164,
        status: "fail",
        requestId,
        ip,
        providerError: "INVALID_TOKEN_FORMAT",
      });
      return NextResponse.json({ error: "문자로 받은 인증번호를 숫자로 입력해 주세요.", code: "INVALID_TOKEN_FORMAT" }, { status: 400 });
    }

    const attemptKey = `phone-otp-verify:user:${user.id}:phone:${hashForOperationalLog(phoneE164)}:600`;
    const attempt = await kvIncrWindow(attemptKey, 600);
    if (attempt.count > 8) {
      await logPhoneVerificationAttempt({
        userId: user.id,
        phoneE164,
        status: "blocked",
        requestId,
        ip,
        providerError: "VERIFY_RATE_LIMIT",
        retryAfterSec: attempt.ttlRemainingSec,
        meta: { count: attempt.count, limit: 8, provider: attempt.provider },
      });
      return NextResponse.json(
        {
          error: `인증번호 확인 시도가 너무 많습니다. ${attempt.ttlRemainingSec}초 후 다시 시도해 주세요.`,
          retryAfterSec: attempt.ttlRemainingSec,
          code: "RATE_LIMITED",
        },
        { status: 429, headers: { "Retry-After": String(attempt.ttlRemainingSec) } }
      );
    }

    const { error: verifyError } = await supabase.auth.verifyOtp({
      phone: phoneE164,
      token,
      type: "phone_change",
    });

    if (verifyError) {
      console.warn(
        `[phone-otp-verify] supabase_auth_error requestId=${requestId} user=${user.id} phoneHash=${hashForOperationalLog(phoneE164)} message=${JSON.stringify(
          verifyError.message
        )}`
      );
      await logPhoneVerificationAttempt({
        userId: user.id,
        phoneE164,
        status: "fail",
        requestId,
        ip,
        providerError: verifyError.message,
      });
      return NextResponse.json({ error: mapVerifyErrorToUserMessage(verifyError.message), code: "VERIFY_FAILED" }, { status: 400 });
    }

    const nowIso = new Date().toISOString();
    const { error: profileError } = await supabase
      .from("profiles")
      .update({
        phone_verified: true,
        phone_e164: phoneE164,
        phone_verified_at: nowIso,
      })
      .eq("user_id", user.id);

    if (profileError) {
      await logPhoneVerificationAttempt({
        userId: user.id,
        phoneE164,
        status: "fail",
        requestId,
        ip,
        providerError: profileError.message,
        meta: { stage: "profile_sync" },
      });
      return NextResponse.json({ error: "인증은 완료됐지만 프로필 반영에 실패했습니다. 잠시 후 다시 확인해 주세요." }, { status: 500 });
    }

    await logPhoneVerificationAttempt({
      userId: user.id,
      phoneE164,
      status: "success",
      requestId,
      ip,
    });

    return NextResponse.json({
      ok: true,
      phone_verified: true,
      phone_e164: phoneE164,
      phone_verified_at: nowIso,
    });
  } catch (error) {
    console.error("[POST /api/mypage/phone-verification/verify] failed", { requestId, error });
    return NextResponse.json({ error: "인증번호 확인 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요." }, { status: 500 });
  }
}
