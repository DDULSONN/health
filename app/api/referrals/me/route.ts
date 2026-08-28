import { NextRequest, NextResponse } from "next/server";
import { getOrCreateReferralCode } from "@/lib/referrals-server";
import { createAdminClient, createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
    }

    const admin = createAdminClient();
    const code = await getOrCreateReferralCode(admin, user.id);
    const [invitedRes, rewardedRes, ownRelationshipRes] = await Promise.all([
      admin
        .from("referral_relationships")
        .select("invitee_user_id", { count: "exact", head: true })
        .eq("inviter_user_id", user.id),
      admin
        .from("referral_relationships")
        .select("invitee_user_id", { count: "exact", head: true })
        .eq("inviter_user_id", user.id)
        .eq("status", "rewarded"),
      admin
        .from("referral_relationships")
        .select("status,claimed_at,rewarded_at")
        .eq("invitee_user_id", user.id)
        .maybeSingle(),
    ]);
    if (invitedRes.error) throw invitedRes.error;
    if (rewardedRes.error) throw rewardedRes.error;
    if (ownRelationshipRes.error) throw ownRelationshipRes.error;

    const configuredSiteUrl = process.env.NEXT_PUBLIC_SITE_URL?.trim();
    const siteOrigin = configuredSiteUrl ? new URL(configuredSiteUrl).origin : request.nextUrl.origin;
    const inviteUrl = new URL("/signup", siteOrigin);
    inviteUrl.searchParams.set("ref", code);

    return NextResponse.json(
      {
        code,
        inviteUrl: inviteUrl.toString(),
        rewardCredits: 5,
        invitedCount: invitedRes.count ?? 0,
        rewardedCount: rewardedRes.count ?? 0,
        joinedWithReferral: Boolean(ownRelationshipRes.data),
        ownReferralStatus: ownRelationshipRes.data?.status ?? null,
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    console.error("[GET /api/referrals/me] failed", error);
    const message = error instanceof Error && error.message === "BANNED_USER"
      ? "밴 처리된 계정에서는 추천 기능을 이용할 수 없습니다."
      : "추천 정보를 불러오지 못했습니다.";
    return NextResponse.json(
      { error: message },
      { status: 500, headers: { "Cache-Control": "no-store" } }
    );
  }
}
