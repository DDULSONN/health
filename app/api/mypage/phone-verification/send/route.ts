import { kvIncrWindow } from "@/lib/edge-kv";
import { checkRouteRateLimit, extractClientIp } from "@/lib/request-rate-limit";
import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

function normalizeToE164(raw: string): string {
  const digits = raw.replace(/[^0-9]/g, "");
  if (!digits) return "";
  if (digits.startsWith("0")) return `+82${digits.slice(1)}`;
  if (digits.startsWith("82")) return `+${digits}`;
  if (digits.startsWith("1")) return `+${digits}`;
  return `+${digits}`;
}

async function enforceOtpWindowLimit(key: string, windowSec: number, limit: number) {
  const result = await kvIncrWindow(key, windowSec);
  if (result.count > limit) {
    return { allowed: false, retryAfterSec: result.ttlRemainingSec };
  }
  return { allowed: true, retryAfterSec: 0 };
}

export async function POST(req: Request) {
  const requestId = crypto.randomUUID();
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const ip = extractClientIp(req);
  const routeLimit = await checkRouteRateLimit({
    requestId,
    scope: "mypage-phone-otp-send",
    userId: user.id,
    ip,
    userLimitPerMin: 3,
    ipLimitPerMin: 10,
    path: "/api/mypage/phone-verification/send",
  });
  if (!routeLimit.allowed) {
    return NextResponse.json(
      { error: `요청이 너무 많습니다. ${routeLimit.retryAfterSec}초 후 다시 시도해주세요.` },
      { status: 429, headers: { "Retry-After": String(routeLimit.retryAfterSec) } }
    );
  }

  const body = (await req.json().catch(() => ({}))) as { phone?: string };
  const phoneE164 = normalizeToE164(body.phone ?? "");
  if (!phoneE164 || phoneE164.length < 11) {
    return NextResponse.json({ error: "휴대폰 번호를 올바르게 입력해주세요." }, { status: 400 });
  }

  const windowChecks = [
    await enforceOtpWindowLimit(`phone-otp-send:user:${user.id}:60`, 60, 1),
    await enforceOtpWindowLimit(`phone-otp-send:user:${user.id}:600`, 600, 3),
    await enforceOtpWindowLimit(`phone-otp-send:user:${user.id}:86400`, 86400, 10),
    await enforceOtpWindowLimit(`phone-otp-send:ip:${ip}:3600`, 3600, 20),
  ];
  const blocked = windowChecks.find((item) => !item.allowed);
  if (blocked) {
    return NextResponse.json(
      { error: `인증번호 재발송이 너무 잦습니다. ${blocked.retryAfterSec}초 후 다시 시도해주세요.` },
      { status: 429, headers: { "Retry-After": String(blocked.retryAfterSec) } }
    );
  }

  const { error } = await supabase.auth.updateUser({ phone: phoneE164 });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ ok: true, pendingPhone: phoneE164 });
}
