import "server-only";

import { randomBytes } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isValidReferralCode, normalizeReferralCode } from "@/lib/referral-code";

const CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
const CODE_RANDOM_LENGTH = 9;

export type ReferralClaimResult = {
  ok: boolean;
  code:
    | "CLAIMED"
    | "ALREADY_CLAIMED"
    | "INVALID_CODE"
    | "INVITEE_NOT_FOUND"
    | "CLAIM_WINDOW_EXPIRED"
    | "SELF_REFERRAL"
    | "INVITER_BANNED"
    | "INVITER_NOT_OLDER"
    | "ALREADY_HAS_REFERRER"
    | "UNKNOWN";
  inviterUserId: string | null;
  inviteeUserId: string;
};

function buildRandomReferralCode() {
  const bytes = randomBytes(CODE_RANDOM_LENGTH);
  let suffix = "";
  for (let index = 0; index < CODE_RANDOM_LENGTH; index += 1) {
    suffix += CODE_ALPHABET[bytes[index] % CODE_ALPHABET.length];
  }
  return `GYM${suffix}`;
}

export async function getOrCreateReferralCode(admin: SupabaseClient, userId: string) {
  const existingRes = await admin
    .from("referral_codes")
    .select("code")
    .eq("user_id", userId)
    .maybeSingle();
  if (existingRes.error) throw existingRes.error;
  if (existingRes.data?.code) return String(existingRes.data.code);

  const profileRes = await admin
    .from("profiles")
    .select("is_banned")
    .eq("user_id", userId)
    .maybeSingle();
  if (profileRes.error) throw profileRes.error;
  if (!profileRes.data) throw new Error("PROFILE_NOT_FOUND");
  if (profileRes.data.is_banned === true) throw new Error("BANNED_USER");

  for (let attempt = 0; attempt < 6; attempt += 1) {
    const code = buildRandomReferralCode();
    const insertRes = await admin.from("referral_codes").insert({ user_id: userId, code });
    if (!insertRes.error) return code;

    if (String(insertRes.error.code ?? "") !== "23505") throw insertRes.error;

    const concurrentRes = await admin
      .from("referral_codes")
      .select("code")
      .eq("user_id", userId)
      .maybeSingle();
    if (concurrentRes.error) throw concurrentRes.error;
    if (concurrentRes.data?.code) return String(concurrentRes.data.code);
  }

  throw new Error("REFERRAL_CODE_GENERATION_FAILED");
}

export async function claimReferralRelationship(
  admin: SupabaseClient,
  inviteeUserId: string,
  rawCode: unknown
): Promise<ReferralClaimResult> {
  const code = normalizeReferralCode(rawCode);
  if (!isValidReferralCode(code)) {
    return { ok: false, code: "INVALID_CODE", inviterUserId: null, inviteeUserId };
  }

  const rpcRes = await admin.rpc("claim_referral_relationship", {
    p_invitee_user_id: inviteeUserId,
    p_referral_code: code,
  });
  if (rpcRes.error) throw rpcRes.error;

  const row = Array.isArray(rpcRes.data) ? rpcRes.data[0] : null;
  const resultCode = String(row?.result_code ?? "UNKNOWN") as ReferralClaimResult["code"];
  return {
    ok: resultCode === "CLAIMED" || resultCode === "ALREADY_CLAIMED",
    code: resultCode,
    inviterUserId: row?.result_inviter_user_id ? String(row.result_inviter_user_id) : null,
    inviteeUserId,
  };
}

export function referralClaimMessage(code: ReferralClaimResult["code"]) {
  if (code === "CLAIMED" || code === "ALREADY_CLAIMED") return "추천 관계가 등록되었습니다.";
  if (code === "CLAIM_WINDOW_EXPIRED") return "추천 코드는 가입 후 72시간 안에만 등록할 수 있습니다.";
  if (code === "SELF_REFERRAL") return "본인의 추천 코드는 사용할 수 없습니다.";
  if (code === "ALREADY_HAS_REFERRER") return "이미 다른 추천인이 등록되어 있습니다.";
  if (code === "INVITER_BANNED") return "사용할 수 없는 추천 코드입니다.";
  if (code === "INVITER_NOT_OLDER") return "가입자보다 먼저 가입한 회원의 추천 코드만 사용할 수 있습니다.";
  return "유효하지 않은 추천 코드입니다.";
}
