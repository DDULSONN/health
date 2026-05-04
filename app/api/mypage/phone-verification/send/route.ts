import { kvIncrWindow } from "@/lib/edge-kv";
import { getPhoneValidationMessage, hashForOperationalLog, normalizePhoneToE164 } from "@/lib/phone-verification";
import { checkRouteRateLimit, extractClientIp } from "@/lib/request-rate-limit";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

const ATTEMPT_LOG_TABLE = "profile_phone_verification_attempts";

function mapAuthErrorToUserMessage(message: string): string {
  const lower = message.toLowerCase();
  if (lower.includes("already") && lower.includes("phone")) {
    return "이미 다른 계정에 등록된 번호입니다.";
  }
  if (lower.includes("invalid") && lower.includes("phone")) {
    return "휴대폰번호 형식이 올바르지 않습니다.";
  }
  if ((lower.includes("sms") || lower.includes("otp")) && (lower.includes("rate") || lower.includes("too many"))) {
    return "문자 발송이 잠시 지연 중입니다. 잠시 후 다시 시도해 주세요.";
  }
  return "인증번호 발송에 실패했습니다. 잠시 후 다시 시도해 주세요.";
}

async function enforceOtpWindowLimit(key: string, windowSec: number, limit: number) {
  const result = await kvIncrWindow(key, windowSec);
  if (result.count > limit) {
    return { allowed: false, retryAfterSec: result.ttlRemainingSec, count: result.count, provider: result.provider };
  }
  return { allowed: true, retryAfterSec: 0, count: result.count, provider: result.provider };
}

async function logPhoneVerificationAttempt(input: {
  userId: string | null;
  phoneE164: string | null;
  action: "send";
  status: "queued" | "fail" | "blocked";
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
      action: input.action,
      status: input.status,
      provider: "supabase_auth",
      provider_error: input.providerError ?? null,
      request_id: input.requestId,
      ip_hash: hashForOperationalLog(input.ip),
      retry_after_sec: input.retryAfterSec ?? null,
      meta: input.meta ?? {},
    });
    if (res.error && res.error.code !== "42P01") {
      console.warn("[phone-otp-send] failed_to_insert_attempt_log", res.error.message);
    }
  } catch (error) {
    console.warn("[phone-otp-send] attempt_log_unavailable", error);
  }
}

export async function POST(req: Request) {
  const requestId = crypto.randomUUID();

  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
    }

    const ip = extractClientIp(req);
    const routeLimit = await checkRouteRateLimit({
      requestId,
      scope: "mypage-phone-otp-send",
      userId: user.id,
      ip,
      userLimitPerMin: 3,
      ipLimitPerMin: 20,
      path: "/api/mypage/phone-verification/send",
    });
    if (!routeLimit.allowed) {
      return NextResponse.json(
        { error: `요청이 너무 많습니다. ${routeLimit.retryAfterSec}초 후 다시 시도해 주세요.`, retryAfterSec: routeLimit.retryAfterSec },
        { status: 429, headers: { "Retry-After": String(routeLimit.retryAfterSec) } }
      );
    }

    const body = (await req.json().catch(() => ({}))) as { phone?: string };
    const phoneE164 = normalizePhoneToE164(body.phone ?? "");
    const validationMessage = getPhoneValidationMessage(phoneE164);
    if (validationMessage) {
      await logPhoneVerificationAttempt({
        userId: user.id,
        phoneE164: phoneE164 || null,
        action: "send",
        status: "fail",
        requestId,
        ip,
        providerError: "INVALID_PHONE_FORMAT",
      });
      return NextResponse.json({ error: validationMessage, code: "INVALID_PHONE_FORMAT" }, { status: 400 });
    }

    const windowRules = [
      { key: `phone-otp-send:user:${user.id}:60`, windowSec: 60, limit: 1, label: "user_60s" },
      { key: `phone-otp-send:user:${user.id}:600`, windowSec: 600, limit: 5, label: "user_10m" },
      { key: `phone-otp-send:user:${user.id}:86400`, windowSec: 86400, limit: 15, label: "user_1d" },
      { key: `phone-otp-send:ip:${ip}:3600`, windowSec: 3600, limit: 60, label: "ip_1h" },
    ] as const;
    const checks = await Promise.all(windowRules.map((rule) => enforceOtpWindowLimit(rule.key, rule.windowSec, rule.limit)));
    const blockedIndex = checks.findIndex((item) => !item.allowed);
    if (blockedIndex >= 0) {
      const blocked = checks[blockedIndex];
      const rule = windowRules[blockedIndex];
      console.warn(
        `[phone-otp-send] blocked requestId=${requestId} user=${user.id} ipHash=${hashForOperationalLog(ip)} phoneHash=${hashForOperationalLog(phoneE164)} rule=${rule.label} count=${blocked.count}/${rule.limit} provider=${blocked.provider}`
      );
      await logPhoneVerificationAttempt({
        userId: user.id,
        phoneE164,
        action: "send",
        status: "blocked",
        requestId,
        ip,
        providerError: `RATE_LIMIT_${rule.label}`,
        retryAfterSec: blocked.retryAfterSec,
        meta: { count: blocked.count, limit: rule.limit, provider: blocked.provider },
      });
      return NextResponse.json(
        {
          error: `인증번호 재발송이 너무 잦습니다. ${blocked.retryAfterSec}초 후 다시 시도해 주세요.`,
          retryAfterSec: blocked.retryAfterSec,
          code: "RATE_LIMITED",
        },
        { status: 429, headers: { "Retry-After": String(blocked.retryAfterSec) } }
      );
    }

    const { error } = await supabase.auth.updateUser({ phone: phoneE164 });
    if (error) {
      console.warn(
        `[phone-otp-send] supabase_auth_error requestId=${requestId} user=${user.id} ipHash=${hashForOperationalLog(ip)} phoneHash=${hashForOperationalLog(phoneE164)} message=${JSON.stringify(
          error.message
        )}`
      );
      await logPhoneVerificationAttempt({
        userId: user.id,
        phoneE164,
        action: "send",
        status: "fail",
        requestId,
        ip,
        providerError: error.message,
      });
      return NextResponse.json({ error: mapAuthErrorToUserMessage(error.message), code: "SUPABASE_AUTH_ERROR" }, { status: 400 });
    }

    console.info(
      `[phone-otp-send] queued requestId=${requestId} user=${user.id} ipHash=${hashForOperationalLog(ip)} phoneHash=${hashForOperationalLog(phoneE164)}`
    );
    await logPhoneVerificationAttempt({
      userId: user.id,
      phoneE164,
      action: "send",
      status: "queued",
      requestId,
      ip,
    });
    return NextResponse.json({
      ok: true,
      pendingPhone: phoneE164,
      message: "인증번호를 보냈어요. 보통 1분 안에 도착하지만 통신사 사정에 따라 조금 늦을 수 있습니다.",
      resendAfterSec: 60,
    });
  } catch (error) {
    console.error("[POST /api/mypage/phone-verification/send] failed", { requestId, error });
    return NextResponse.json({ error: "인증번호 발송 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요." }, { status: 500 });
  }
}
