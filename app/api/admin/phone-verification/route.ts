import { NextResponse } from "next/server";
import { requireAdminRoute } from "@/lib/admin-route";

function normalizeToE164(raw: string): string {
  const digits = raw.replace(/[^0-9]/g, "");
  if (!digits) return "";
  if (digits.startsWith("0")) return `+82${digits.slice(1)}`;
  if (digits.startsWith("82")) return `+${digits}`;
  if (digits.startsWith("1") && digits.length === 11) return `+${digits}`;
  return `+${digits}`;
}

function isLikelyValidE164(phone: string): boolean {
  return /^\+[1-9][0-9]{7,14}$/.test(phone);
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export async function POST(request: Request) {
  const auth = await requireAdminRoute();
  if (!auth.ok) return auth.response;

  const body = (await request.json().catch(() => ({}))) as {
    userId?: string;
    phone?: string;
  };

  const userId = body.userId?.trim() ?? "";
  const phoneE164 = normalizeToE164(body.phone ?? "");

  if (!userId || !isUuid(userId)) {
    return NextResponse.json({ error: "대상 사용자 ID를 정확히 입력해주세요." }, { status: 400 });
  }

  if (!phoneE164 || !isLikelyValidE164(phoneE164)) {
    return NextResponse.json({ error: "휴대폰 번호를 올바르게 입력해주세요." }, { status: 400 });
  }

  const userRes = await auth.admin.auth.admin.getUserById(userId).catch(() => null);
  if (!userRes?.data?.user) {
    return NextResponse.json({ error: "해당 사용자 계정을 찾지 못했습니다." }, { status: 404 });
  }

  const { data: profile, error: profileError } = await auth.admin
    .from("profiles")
    .select("user_id,nickname")
    .eq("user_id", userId)
    .maybeSingle();

  if (profileError) {
    return NextResponse.json({ error: profileError.message }, { status: 500 });
  }

  if (!profile) {
    return NextResponse.json({ error: "대상 사용자 프로필을 찾지 못했습니다." }, { status: 404 });
  }

  const phoneVerifiedAt = new Date().toISOString();
  const { error: updateError } = await auth.admin
    .from("profiles")
    .update({
      phone_verified: true,
      phone_e164: phoneE164,
      phone_verified_at: phoneVerifiedAt,
    })
    .eq("user_id", userId);

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    user_id: userId,
    nickname: profile.nickname ?? null,
    phone_e164: phoneE164,
    phone_verified: true,
    phone_verified_at: phoneVerifiedAt,
  });
}
