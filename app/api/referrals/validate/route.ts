import { NextRequest, NextResponse } from "next/server";
import { isValidReferralCode, normalizeReferralCode } from "@/lib/referral-code";
import { createAdminClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const code = normalizeReferralCode(request.nextUrl.searchParams.get("code"));
  if (!isValidReferralCode(code)) {
    return NextResponse.json(
      { valid: false, message: "추천 코드 형식이 올바르지 않습니다." },
      { status: 400, headers: { "Cache-Control": "no-store" } }
    );
  }

  try {
    const admin = createAdminClient();
    const codeRes = await admin
      .from("referral_codes")
      .select("user_id")
      .eq("code", code)
      .maybeSingle();
    if (codeRes.error) throw codeRes.error;
    if (!codeRes.data?.user_id) {
      return NextResponse.json(
        { valid: false, message: "유효하지 않은 추천 코드입니다." },
        { status: 404, headers: { "Cache-Control": "no-store" } }
      );
    }

    const profileRes = await admin
      .from("profiles")
      .select("nickname,is_banned")
      .eq("user_id", codeRes.data.user_id)
      .maybeSingle();
    if (profileRes.error) throw profileRes.error;
    if (!profileRes.data || profileRes.data.is_banned === true) {
      return NextResponse.json(
        { valid: false, message: "사용할 수 없는 추천 코드입니다." },
        { status: 404, headers: { "Cache-Control": "no-store" } }
      );
    }

    return NextResponse.json(
      {
        valid: true,
        code,
        inviterNickname: String(profileRes.data.nickname ?? "").trim() || null,
        message: "사용 가능한 추천 코드입니다.",
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    console.error("[GET /api/referrals/validate] failed", error);
    return NextResponse.json(
      { valid: false, message: "추천 코드를 확인하지 못했습니다." },
      { status: 500, headers: { "Cache-Control": "no-store" } }
    );
  }
}
