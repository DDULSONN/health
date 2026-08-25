import { NextResponse } from "next/server";
import { kvIncrWindow } from "@/lib/edge-kv";
import {
  EMPLOYMENT_CHALLENGE_KEY,
  EMPLOYMENT_RESEND_SECONDS,
  createEmploymentOtp,
  normalizeCompanyName,
  readEmploymentChallenge,
  readEmploymentVerification,
  validateWorkEmailMailboxDomain,
} from "@/lib/employment-verification";
import { ensureAllowedMutationOrigin } from "@/lib/request-origin";
import { checkRouteRateLimit, extractClientIp } from "@/lib/request-rate-limit";
import { createAdminClient, createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

async function sendOtpEmail(input: { email: string; code: string; companyName: string; challengeId: string }) {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from = process.env.NOTIFY_FROM_EMAIL?.trim();
  if (!apiKey || !from) return { ok: false as const, code: "EMAIL_CONFIG_MISSING" };

  const safeCompanyName = input.companyName
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
  const subject = `[짐툴] 직장 이메일 인증번호 ${input.code}`;
  const text = [
    "짐툴 직장인 인증을 위한 인증번호입니다.",
    "",
    `인증번호: ${input.code}`,
    "",
    "인증번호는 10분 동안 유효합니다.",
    "본인이 요청하지 않았다면 이 메일을 무시해주세요.",
  ].join("\n");
  const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:#f5f5f5;padding:24px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#171717"><div style="max-width:520px;margin:0 auto;background:#fff;border:1px solid #e5e5e5;border-radius:16px;padding:28px"><div style="font-size:13px;font-weight:700;color:#7c3aed">짐툴 직장인 인증</div><h1 style="margin:12px 0 8px;font-size:22px">이메일 인증번호</h1><p style="margin:0;color:#525252;font-size:14px;line-height:1.7">${safeCompanyName} 직장 이메일 인증을 위해 아래 번호를 입력해주세요.</p><div style="margin:24px 0;padding:18px;border-radius:12px;background:#f5f3ff;text-align:center;font-size:32px;font-weight:800;letter-spacing:8px;color:#5b21b6">${input.code}</div><p style="margin:0;color:#737373;font-size:12px;line-height:1.7">인증번호는 10분 동안 유효합니다.<br>본인이 요청하지 않았다면 이 메일을 무시해주세요.</p></div></body></html>`;

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": `employment-otp-${input.challengeId}`,
      },
      body: JSON.stringify({ from, to: [input.email], subject, text, html }),
    });
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      console.error("[employment-otp-send] resend rejected", { status: response.status });
      return { ok: false as const, code: "EMAIL_PROVIDER_ERROR" };
    }
    return { ok: true as const };
  } catch (error) {
    console.error("[employment-otp-send] resend request failed", error);
    return { ok: false as const, code: "EMAIL_PROVIDER_ERROR" };
  }
}

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  const originResponse = ensureAllowedMutationOrigin(request);
  if (originResponse) return originResponse;

  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ ok: false, error: "로그인이 필요합니다." }, { status: 401 });

    const ip = extractClientIp(request);
    const routeLimit = await checkRouteRateLimit({
      requestId,
      scope: "mypage-employment-otp-send",
      userId: user.id,
      ip,
      userLimitPerMin: 2,
      ipLimitPerMin: 20,
      path: "/api/mypage/employment-verification/send",
    });
    if (!routeLimit.allowed) {
      return NextResponse.json(
        { ok: false, error: `${routeLimit.retryAfterSec}초 후 다시 시도해주세요.`, retryAfterSec: routeLimit.retryAfterSec },
        { status: 429, headers: { "Retry-After": String(routeLimit.retryAfterSec) } }
      );
    }

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const companyName = normalizeCompanyName(body.companyName);
    const emailResult = await validateWorkEmailMailboxDomain(body.email);
    if (!companyName) {
      return NextResponse.json({ ok: false, error: "회사명을 입력해주세요." }, { status: 400 });
    }
    if (!emailResult.ok) {
      return NextResponse.json(
        { ok: false, error: emailResult.error },
        { status: "temporary" in emailResult && emailResult.temporary ? 503 : 400 }
      );
    }

    const admin = createAdminClient();
    const { data: authData, error: authError } = await admin.auth.admin.getUserById(user.id);
    if (authError || !authData.user) throw authError ?? new Error("auth user missing");

    const currentVerification = readEmploymentVerification(authData.user);
    if (currentVerification?.status === "revoked") {
      return NextResponse.json(
        { ok: false, error: "관리자에 의해 직장 인증이 취소된 계정입니다. 재인증은 고객센터로 문의해주세요." },
        { status: 403 }
      );
    }

    const currentChallenge = readEmploymentChallenge(authData.user);
    if (currentChallenge) {
      const elapsedSec = Math.floor((Date.now() - new Date(currentChallenge.sent_at).getTime()) / 1000);
      if (elapsedSec >= 0 && elapsedSec < EMPLOYMENT_RESEND_SECONDS) {
        const retryAfterSec = EMPLOYMENT_RESEND_SECONDS - elapsedSec;
        return NextResponse.json(
          { ok: false, error: `${retryAfterSec}초 후 재발송할 수 있습니다.`, retryAfterSec },
          { status: 429, headers: { "Retry-After": String(retryAfterSec) } }
        );
      }
    }

    const dailyLimit = await kvIncrWindow(`employment-otp-send:user:${user.id}:86400`, 86400);
    if (dailyLimit.count > 10) {
      return NextResponse.json(
        { ok: false, error: "오늘 인증번호 발송 한도를 초과했습니다. 내일 다시 시도해주세요.", retryAfterSec: dailyLimit.ttlRemainingSec },
        { status: 429, headers: { "Retry-After": String(dailyLimit.ttlRemainingSec) } }
      );
    }

    const { code, challenge } = createEmploymentOtp({ userId: user.id, email: emailResult.email, companyName });
    const nextMetadata = { ...(authData.user.app_metadata ?? {}), [EMPLOYMENT_CHALLENGE_KEY]: challenge };
    const { error: saveError } = await admin.auth.admin.updateUserById(user.id, { app_metadata: nextMetadata });
    if (saveError) throw saveError;

    const sendResult = await sendOtpEmail({
      email: emailResult.email,
      code,
      companyName,
      challengeId: challenge.id,
    });
    if (!sendResult.ok) {
      const latest = await admin.auth.admin.getUserById(user.id);
      if (latest.data.user && readEmploymentChallenge(latest.data.user)?.id === challenge.id) {
        await admin.auth.admin.updateUserById(user.id, {
          app_metadata: { ...(latest.data.user.app_metadata ?? {}), [EMPLOYMENT_CHALLENGE_KEY]: null },
        });
      }
      const configMissing = sendResult.code === "EMAIL_CONFIG_MISSING";
      return NextResponse.json(
        { ok: false, error: configMissing ? "이메일 발송 설정을 확인 중입니다. 관리자에게 문의해주세요." : "이메일 발송에 실패했습니다. 잠시 후 다시 시도해주세요." },
        { status: configMissing ? 503 : 502 }
      );
    }

    console.info("[employment-otp-send] queued", { requestId, userId: user.id, domain: emailResult.domain });
    return NextResponse.json({
      ok: true,
      maskedEmail: challenge.masked_email,
      expiresAt: challenge.expires_at,
      resendAfterSec: EMPLOYMENT_RESEND_SECONDS,
      message: `${challenge.masked_email}로 인증번호를 발송했습니다.`,
    });
  } catch (error) {
    console.error("[POST /api/mypage/employment-verification/send] failed", { requestId, error });
    return NextResponse.json({ ok: false, error: "인증번호 발송 중 오류가 발생했습니다." }, { status: 500 });
  }
}
