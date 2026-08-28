import { NextResponse } from "next/server";
import { ensureAllowedMutationOrigin } from "@/lib/request-origin";
import { claimReferralRelationship, referralClaimMessage } from "@/lib/referrals-server";
import { createAdminClient, createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const originResponse = ensureAllowedMutationOrigin(request);
  if (originResponse) return originResponse;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, message: "로그인이 필요합니다." }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as { code?: unknown };
  try {
    const result = await claimReferralRelationship(createAdminClient(), user.id, body.code);
    const status = result.ok ? 200 : result.code === "INVALID_CODE" ? 400 : 409;
    return NextResponse.json(
      { ...result, message: referralClaimMessage(result.code) },
      { status, headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    console.error("[POST /api/referrals/claim] failed", error);
    return NextResponse.json(
      { ok: false, message: "추천 관계를 등록하지 못했습니다." },
      { status: 500, headers: { "Cache-Control": "no-store" } }
    );
  }
}
