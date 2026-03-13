import { createAdminClient, createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

type ClaimBody = {
  reward_code?: string;
};

function mapClaimError(message: string) {
  if (message.includes("FORBIDDEN")) return { status: 403, message: "보상을 받을 권한이 없습니다." };
  if (message.includes("REWARD_ALREADY_CLAIMED")) return { status: 409, message: "이미 받은 보상입니다." };
  if (message.includes("REWARD_CONDITION_NOT_MET")) return { status: 400, message: "아직 보상 조건을 만족하지 않았습니다." };
  if (message.includes("INVALID_REWARD_CODE")) return { status: 400, message: "유효하지 않은 보상 코드입니다." };
  if (message.includes("PROFILE_NOT_FOUND")) return { status: 404, message: "투표 프로필을 찾지 못했습니다." };
  return { status: 500, message: "보상 수령에 실패했습니다." };
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ ok: false, message: "로그인이 필요합니다." }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as ClaimBody;
  const rewardCode = (body.reward_code ?? "").trim();
  if (!rewardCode) {
    return NextResponse.json({ ok: false, message: "보상 코드가 필요합니다." }, { status: 400 });
  }

  const admin = createAdminClient();
  const claimRes = await admin.rpc("bodybattle_claim_reward", {
    p_user_id: user.id,
    p_reward_code: rewardCode,
  });
  if (claimRes.error) {
    const mapped = mapClaimError(claimRes.error.message);
    return NextResponse.json({ ok: false, message: mapped.message }, { status: mapped.status });
  }

  const row = Array.isArray(claimRes.data) ? claimRes.data[0] : claimRes.data;
  return NextResponse.json({
    ok: true,
    claimed: row ?? null,
  });
}
