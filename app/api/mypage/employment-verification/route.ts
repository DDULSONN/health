import { NextResponse } from "next/server";
import {
  EMPLOYMENT_RESEND_SECONDS,
  readEmploymentChallenge,
  readEmploymentVerification,
  serializeEmploymentVerification,
} from "@/lib/employment-verification";
import { createAdminClient, createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ ok: false, error: "로그인이 필요합니다." }, { status: 401 });

    const admin = createAdminClient();
    const { data, error } = await admin.auth.admin.getUserById(user.id);
    if (error || !data.user) {
      return NextResponse.json({ ok: false, error: "직장 인증 상태를 확인하지 못했습니다." }, { status: 404 });
    }

    const challenge = readEmploymentChallenge(data.user);
    const now = Date.now();
    const pending = challenge && new Date(challenge.expires_at).getTime() > now
      ? {
          maskedEmail: challenge.masked_email,
          companyName: challenge.company_name,
          emailDomain: challenge.email_domain,
          expiresAt: challenge.expires_at,
          resendAfterSec: Math.max(
            0,
            EMPLOYMENT_RESEND_SECONDS - Math.floor((now - new Date(challenge.sent_at).getTime()) / 1000)
          ),
        }
      : null;

    return NextResponse.json({
      ok: true,
      verification: serializeEmploymentVerification(readEmploymentVerification(data.user)),
      pending,
    });
  } catch (error) {
    console.error("[GET /api/mypage/employment-verification] failed", error);
    return NextResponse.json({ ok: false, error: "직장 인증 상태를 불러오지 못했습니다." }, { status: 500 });
  }
}
