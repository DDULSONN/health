import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireAdminRoute } from "@/lib/admin-route";
import { getOrCreateReferralCode } from "@/lib/referrals-server";

const REFERRAL_REWARD_CREDITS = 5;
const ACTIVE_OPEN_CARD_STATUSES = ["pending", "public"] as const;
const ACTIVE_ONE_ON_ONE_STATUSES = ["submitted", "reviewing", "approved"] as const;

type Member = {
  userId: string;
  nickname: string | null;
  email: string | null;
  phoneVerified: boolean;
  isBanned: boolean;
};

function json(status: number, payload: Record<string, unknown>) {
  return NextResponse.json(payload, { status });
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function isMissingReferralSchemaError(error: { code?: string; message?: string } | null | undefined) {
  const code = String(error?.code ?? "");
  const message = String(error?.message ?? "").toLowerCase();
  return (
    code === "42P01" ||
    code === "PGRST205" ||
    (message.includes("referral_relationships") && message.includes("does not exist"))
  );
}

async function memberFromUserId(admin: SupabaseClient, userId: string, emailInput?: string | null) {
  const [profileRes, authRes] = await Promise.all([
    admin
      .from("profiles")
      .select("user_id,nickname,phone_verified,is_banned")
      .eq("user_id", userId)
      .maybeSingle(),
    emailInput == null ? admin.auth.admin.getUserById(userId).catch(() => null) : Promise.resolve(null),
  ]);

  if (profileRes.error) throw profileRes.error;
  const authUser = authRes?.data?.user ?? null;
  if (!profileRes.data && !authUser && emailInput == null) return null;

  return {
    userId,
    nickname: typeof profileRes.data?.nickname === "string" ? profileRes.data.nickname : null,
    email: emailInput ?? authUser?.email ?? null,
    phoneVerified: profileRes.data?.phone_verified === true,
    isBanned: profileRes.data?.is_banned === true,
  } satisfies Member;
}

async function findAuthUserByEmail(admin: SupabaseClient, email: string) {
  const normalized = email.trim().toLowerCase();
  if (!normalized.includes("@")) return null;

  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    const found = data.users.find((user) => (user.email ?? "").trim().toLowerCase() === normalized);
    if (found) return found;
    if (data.users.length < 1000) break;
  }
  return null;
}

async function resolveMember(admin: SupabaseClient, identifier: string) {
  const value = identifier.trim();
  if (!value) return { member: null, error: "회원 식별값을 입력해 주세요." };

  if (isUuid(value)) {
    const member = await memberFromUserId(admin, value);
    return member ? { member, error: null } : { member: null, error: "해당 사용자 ID를 찾지 못했습니다." };
  }

  if (value.includes("@")) {
    const authUser = await findAuthUserByEmail(admin, value);
    if (!authUser) return { member: null, error: "해당 이메일 회원을 찾지 못했습니다." };
    const member = await memberFromUserId(admin, authUser.id, authUser.email ?? value);
    return member ? { member, error: null } : { member: null, error: "해당 이메일 회원 정보를 찾지 못했습니다." };
  }

  const profilesRes = await admin
    .from("profiles")
    .select("user_id,nickname,phone_verified,is_banned")
    .eq("nickname", value)
    .limit(2);
  if (profilesRes.error) throw profilesRes.error;
  const profiles = profilesRes.data ?? [];
  if (profiles.length !== 1) {
    return {
      member: null,
      error: profiles.length > 1 ? "같은 닉네임 회원이 여러 명입니다. 이메일이나 사용자 ID를 사용해 주세요." : "해당 닉네임 회원을 찾지 못했습니다.",
    };
  }

  const row = profiles[0];
  return {
    member: {
      userId: String(row.user_id),
      nickname: typeof row.nickname === "string" ? row.nickname : null,
      email: null,
      phoneVerified: row.phone_verified === true,
      isBanned: row.is_banned === true,
    } satisfies Member,
    error: null,
  };
}

async function checkInviteeEligibility(admin: SupabaseClient, invitee: Member) {
  const [openCardRes, oneOnOneRes] = await Promise.all([
    admin
      .from("dating_cards")
      .select("id", { count: "exact", head: true })
      .eq("owner_user_id", invitee.userId)
      .in("status", [...ACTIVE_OPEN_CARD_STATUSES]),
    admin
      .from("dating_1on1_cards")
      .select("id", { count: "exact", head: true })
      .eq("user_id", invitee.userId)
      .in("status", [...ACTIVE_ONE_ON_ONE_STATUSES]),
  ]);

  if (openCardRes.error) throw openCardRes.error;
  if (oneOnOneRes.error) throw oneOnOneRes.error;

  const hasOpenCard = (openCardRes.count ?? 0) > 0;
  const hasOneOnOneCard = (oneOnOneRes.count ?? 0) > 0;
  return {
    phoneVerified: invitee.phoneVerified,
    hasOpenCard,
    hasOneOnOneCard,
    hasMatchingProfile: hasOpenCard || hasOneOnOneCard,
    eligible: invitee.phoneVerified && (hasOpenCard || hasOneOnOneCard) && !invitee.isBanned,
  };
}

export async function GET() {
  const auth = await requireAdminRoute();
  if (!auth.ok) return auth.response;

  const requestId = crypto.randomUUID();
  try {
    const [recentRes, totalRes, rewardedRes] = await Promise.all([
      auth.admin
        .from("referral_relationships")
        .select("invitee_user_id,inviter_user_id,referral_code,status,claimed_at,rewarded_at")
        .order("claimed_at", { ascending: false })
        .limit(50),
      auth.admin
        .from("referral_relationships")
        .select("invitee_user_id", { count: "exact", head: true }),
      auth.admin
        .from("referral_relationships")
        .select("invitee_user_id", { count: "exact", head: true })
        .eq("status", "rewarded"),
    ]);
    if (recentRes.error) throw recentRes.error;
    if (totalRes.error) throw totalRes.error;
    if (rewardedRes.error) throw rewardedRes.error;

    const rows = recentRes.data ?? [];
    const userIds = [...new Set(rows.flatMap((row) => [String(row.inviter_user_id), String(row.invitee_user_id)]))];
    const profilesRes = userIds.length
      ? await auth.admin.from("profiles").select("user_id,nickname").in("user_id", userIds)
      : { data: [], error: null };
    if (profilesRes.error) throw profilesRes.error;
    const nicknameByUserId = new Map(
      (profilesRes.data ?? []).map((profile) => [String(profile.user_id), String(profile.nickname ?? "").trim() || null])
    );

    return json(200, {
      ok: true,
      requestId,
      summary: {
        total: totalRes.count ?? 0,
        rewarded: rewardedRes.count ?? 0,
        pending: Math.max(0, (totalRes.count ?? 0) - (rewardedRes.count ?? 0)),
      },
      recent: rows.map((row) => ({
        ...row,
        inviter_nickname: nicknameByUserId.get(String(row.inviter_user_id)) ?? null,
        invitee_nickname: nicknameByUserId.get(String(row.invitee_user_id)) ?? null,
      })),
    });
  } catch (error) {
    console.error(`[admin-referral-reward] ${requestId} overview failed`, error);
    return json(500, { ok: false, requestId, message: "추천 현황을 불러오지 못했습니다." });
  }
}

export async function POST(request: Request) {
  const auth = await requireAdminRoute();
  if (!auth.ok) return auth.response;

  const requestId = crypto.randomUUID();
  try {
    const body = (await request.json().catch(() => ({}))) as {
      action?: unknown;
      inviter?: unknown;
      invitee?: unknown;
    };
    const action = body.action === "grant" ? "grant" : "check";
    const inviterIdentifier = typeof body.inviter === "string" ? body.inviter.trim() : "";
    const inviteeIdentifier = typeof body.invitee === "string" ? body.invitee.trim() : "";
    if (!inviterIdentifier || !inviteeIdentifier) {
      return json(400, { ok: false, requestId, message: "추천인과 초대받은 회원을 모두 입력해 주세요." });
    }

    const [inviterResult, inviteeResult] = await Promise.all([
      resolveMember(auth.admin, inviterIdentifier),
      resolveMember(auth.admin, inviteeIdentifier),
    ]);
    if (!inviterResult.member) {
      return json(404, { ok: false, requestId, message: `추천인: ${inviterResult.error}` });
    }
    if (!inviteeResult.member) {
      return json(404, { ok: false, requestId, message: `초대받은 회원: ${inviteeResult.error}` });
    }

    const inviter = inviterResult.member;
    const invitee = inviteeResult.member;
    if (inviter.userId === invitee.userId) {
      return json(400, { ok: false, requestId, message: "같은 회원을 추천인과 초대받은 회원으로 지정할 수 없습니다." });
    }
    if (inviter.isBanned) {
      return json(409, { ok: false, requestId, message: "밴 처리된 회원은 추천인이 될 수 없습니다." });
    }

    const eligibility = await checkInviteeEligibility(auth.admin, invitee);
    const publicRelationshipRes = await auth.admin
      .from("referral_relationships")
      .select("inviter_user_id,status,claimed_at,rewarded_at")
      .eq("invitee_user_id", invitee.userId)
      .maybeSingle();
    if (publicRelationshipRes.error) {
      if (isMissingReferralSchemaError(publicRelationshipRes.error)) {
        return json(503, {
          ok: false,
          requestId,
          message: "추천 보상 SQL을 먼저 적용해야 합니다. SQL 적용 전에는 수동 지급도 진행하지 않습니다.",
        });
      }
      throw publicRelationshipRes.error;
    }
    const publicRelationship = publicRelationshipRes.data;
    if (publicRelationship && String(publicRelationship.inviter_user_id) !== inviter.userId) {
      return json(409, {
        ok: false,
        requestId,
        inviter,
        invitee,
        eligibility,
        inviteeClaimedByAnotherPair: true,
        message: "초대받은 회원은 이미 다른 추천인과 가입 추천 관계가 등록되어 있습니다.",
      });
    }
    if (publicRelationship) {
      const publicAlreadyRewarded = publicRelationship.status === "rewarded";
      const publicPayload = {
        ok: true,
        requestId,
        rewardCredits: REFERRAL_REWARD_CREDITS,
        inviter,
        invitee,
        eligibility,
        alreadyGranted: publicAlreadyRewarded,
        inviteeClaimedByAnotherPair: false,
        publicReferralStatus: publicRelationship.status,
      };
      if (action === "check") return json(200, publicPayload);
      if (publicAlreadyRewarded) {
        return json(200, { ...publicPayload, message: "이미 자동 추천 보상으로 양쪽에 지원권 5장을 지급했습니다." });
      }
      if (!eligibility.eligible) {
        return json(409, {
          ...publicPayload,
          ok: false,
          message: "초대받은 회원이 휴대폰 인증과 매칭 프로필 등록 조건을 모두 충족하지 않았습니다.",
        });
      }

      const rewardRes = await auth.admin.rpc("try_complete_referral_reward", {
        p_invitee_user_id: invitee.userId,
      });
      if (rewardRes.error) throw rewardRes.error;
      const rewardRow = Array.isArray(rewardRes.data) ? rewardRes.data[0] : null;
      const rewardCode = String(rewardRow?.result_code ?? "");
      if (rewardCode !== "REWARDED" && rewardCode !== "ALREADY_REWARDED") {
        return json(409, {
          ...publicPayload,
          ok: false,
          message: `자동 추천 보상을 지급하지 못했습니다. (${rewardCode || "UNKNOWN"})`,
        });
      }
      return json(200, {
        ...publicPayload,
        alreadyGranted: rewardCode === "ALREADY_REWARDED",
        granted: rewardCode === "REWARDED",
        inviterGrant: { creditsAfter: Number(rewardRow?.inviter_credits_after ?? 0) },
        inviteeGrant: { creditsAfter: Number(rewardRow?.invitee_credits_after ?? 0) },
        message: rewardCode === "REWARDED"
          ? "가입 추천 관계의 양쪽 회원에게 지원권 5장씩 지급했습니다."
          : "이미 양쪽 회원에게 추천 보상이 지급되어 있습니다.",
      });
    }

    const basePayload = {
      ok: true,
      requestId,
      rewardCredits: REFERRAL_REWARD_CREDITS,
      inviter,
      invitee,
      eligibility,
      alreadyGranted: false,
      inviteeClaimedByAnotherPair: false,
      publicReferralStatus: null,
    };
    if (action === "check") {
      return json(200, basePayload);
    }
    if (!eligibility.eligible) {
      return json(409, {
        ...basePayload,
        ok: false,
        message: "초대받은 회원이 휴대폰 인증과 매칭 프로필 등록 조건을 모두 충족하지 않았습니다.",
      });
    }

    const [inviterAuthRes, inviteeAuthRes] = await Promise.all([
      auth.admin.auth.admin.getUserById(inviter.userId),
      auth.admin.auth.admin.getUserById(invitee.userId),
    ]);
    if (inviterAuthRes.error) throw inviterAuthRes.error;
    if (inviteeAuthRes.error) throw inviteeAuthRes.error;
    const inviterCreatedAt = Date.parse(inviterAuthRes.data.user.created_at);
    const inviteeCreatedAt = Date.parse(inviteeAuthRes.data.user.created_at);
    if (!Number.isFinite(inviterCreatedAt) || !Number.isFinite(inviteeCreatedAt) || inviterCreatedAt >= inviteeCreatedAt) {
      return json(409, {
        ...basePayload,
        ok: false,
        message: "추천인은 초대받은 회원보다 먼저 가입한 계정이어야 합니다.",
      });
    }

    const referralCode = await getOrCreateReferralCode(auth.admin, inviter.userId);
    const relationshipInsertRes = await auth.admin.from("referral_relationships").insert({
      invitee_user_id: invitee.userId,
      inviter_user_id: inviter.userId,
      referral_code: referralCode,
      status: "pending",
    });
    if (relationshipInsertRes.error) {
      if (String(relationshipInsertRes.error.code ?? "") !== "23505") throw relationshipInsertRes.error;
      const concurrentRelationshipRes = await auth.admin
        .from("referral_relationships")
        .select("inviter_user_id,status")
        .eq("invitee_user_id", invitee.userId)
        .single();
      if (concurrentRelationshipRes.error) throw concurrentRelationshipRes.error;
      if (String(concurrentRelationshipRes.data.inviter_user_id) !== inviter.userId) {
        return json(409, {
          ...basePayload,
          ok: false,
          inviteeClaimedByAnotherPair: true,
          message: "초대받은 회원은 이미 다른 추천인과 가입 추천 관계가 등록되어 있습니다.",
        });
      }
    }

    const rewardRes = await auth.admin.rpc("try_complete_referral_reward", {
      p_invitee_user_id: invitee.userId,
    });
    if (rewardRes.error) throw rewardRes.error;
    const rewardRow = Array.isArray(rewardRes.data) ? rewardRes.data[0] : null;
    const rewardCode = String(rewardRow?.result_code ?? "");
    if (rewardCode !== "REWARDED" && rewardCode !== "ALREADY_REWARDED") {
      return json(409, {
        ...basePayload,
        ok: false,
        publicReferralStatus: "pending",
        message: `추천 관계는 등록했지만 보상을 지급하지 못했습니다. (${rewardCode || "UNKNOWN"})`,
      });
    }

    return json(200, {
      ...basePayload,
      alreadyGranted: rewardCode === "ALREADY_REWARDED",
      granted: rewardCode === "REWARDED",
      publicReferralStatus: "rewarded",
      inviterGrant: { creditsAfter: Number(rewardRow?.inviter_credits_after ?? 0) },
      inviteeGrant: { creditsAfter: Number(rewardRow?.invitee_credits_after ?? 0) },
      message: rewardCode === "REWARDED"
        ? "추천 관계를 등록하고 양쪽 회원에게 지원권 5장씩 지급했습니다."
        : "이미 같은 추천 관계로 양쪽 회원에게 보상이 지급되어 있습니다.",
    });
  } catch (error) {
    console.error(`[admin-referral-reward] ${requestId} failed`, error);
    return json(500, {
      ok: false,
      requestId,
      message: "추천 보상 처리 중 오류가 발생했습니다. 같은 조합으로 다시 시도하면 중복 없이 이어서 처리됩니다.",
    });
  }
}
