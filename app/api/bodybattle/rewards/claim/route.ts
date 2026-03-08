import { createAdminClient, createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

type ClaimBody = {
  reward_code?: string;
};

function mapClaimError(message: string) {
  if (message.includes("FORBIDDEN")) return { status: 403, message: "Forbidden." };
  if (message.includes("REWARD_ALREADY_CLAIMED")) return { status: 409, message: "Reward already claimed." };
  if (message.includes("REWARD_CONDITION_NOT_MET")) return { status: 400, message: "Reward condition not met yet." };
  if (message.includes("INVALID_REWARD_CODE")) return { status: 400, message: "Invalid reward code." };
  if (message.includes("PROFILE_NOT_FOUND")) return { status: 404, message: "Voter profile not found." };
  return { status: 500, message: "Failed to claim reward." };
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ ok: false, message: "Login required." }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as ClaimBody;
  const rewardCode = (body.reward_code ?? "").trim();
  if (!rewardCode) {
    return NextResponse.json({ ok: false, message: "reward_code is required." }, { status: 400 });
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
