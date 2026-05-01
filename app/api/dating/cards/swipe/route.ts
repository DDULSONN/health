import { checkRouteRateLimit, extractClientIp } from "@/lib/request-rate-limit";
import {
  getLatestSwipeCardForUser,
  getSwipeCandidate,
  getSwipeDailyUsage,
  getSwipeLimitInfo,
  isSwipeLikeExpiryEligible,
  SWIPE_LIKE_EXPIRY_HOURS,
  sendDatingEmailNotification,
} from "@/lib/dating-swipe";
import { recordDatingMatchEvent } from "@/lib/dating-match-metrics";
import { hasDatingBlockBetween } from "@/lib/dating-blocks";
import { getRequestAuthContext } from "@/lib/supabase/request";
import { createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

type SwipeAction = "like" | "pass";

function getPairKey(a: string, b: string): string {
  return [a, b].sort().join(":");
}

function isMissingRelationError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = String((error as { code?: unknown }).code ?? "");
  const message = String((error as { message?: unknown }).message ?? "").toLowerCase();
  return (
    code === "42P01" ||
    code === "PGRST205" ||
    message.includes("does not exist") ||
    message.includes("relation") ||
    message.includes("could not find the table")
  );
}

function sanitizeSex(value: string | null): "male" | "female" | null {
  return value === "male" || value === "female" ? value : null;
}

function sanitizeAction(value: unknown): SwipeAction | null {
  return value === "like" || value === "pass" ? value : null;
}

export async function GET(req: Request) {
  const { user } = await getRequestAuthContext(req);

  if (!user) {
    return NextResponse.json({
      loggedIn: false,
      canSwipe: false,
      remaining: 0,
      limit: 7,
      candidate: null,
      reason: "로그인하면 빠른매칭 후보와 오늘 남은 횟수를 바로 확인할 수 있습니다.",
    });
  }

  const ip = extractClientIp(req);
  const rateLimit = await checkRouteRateLimit({
    requestId: crypto.randomUUID(),
    scope: "dating-cards-swipe-get",
    userId: user.id,
    ip,
    userLimitPerMin: 40,
    ipLimitPerMin: 120,
    path: "/api/dating/cards/swipe",
  });
  if (!rateLimit.allowed) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const { searchParams } = new URL(req.url);
  const sex = sanitizeSex(searchParams.get("sex"));
  if (!sex) {
    return NextResponse.json({ error: "성별 정보가 올바르지 않습니다." }, { status: 400 });
  }

  const adminClient = createAdminClient();

  try {
    const limitInfo = await getSwipeLimitInfo(adminClient, user.id);
    const dailyLimit = limitInfo.limit;
    const myCard = await getLatestSwipeCardForUser(adminClient, user.id);
    if (!myCard) {
      const candidate = await getSwipeCandidate(adminClient, user.id, sex);
      return NextResponse.json({
        loggedIn: true,
        canSwipe: false,
        remaining: dailyLimit,
        limit: dailyLimit,
        candidate,
        reason: candidate
          ? "후보는 미리 볼 수 있어요. 라이크나 넘기기는 오픈카드 등록 후 이용 가능합니다."
          : "후보는 미리 볼 수 있어요. 라이크나 넘기기는 오픈카드 등록 후 이용 가능합니다.",
      });
    }

    const used = await getSwipeDailyUsage(adminClient, user.id);
    const remaining = Math.max(0, dailyLimit - used);
    if (remaining <= 0) {
      return NextResponse.json({
        loggedIn: true,
        canSwipe: false,
        remaining,
        limit: dailyLimit,
        candidate: null,
        reason: "오늘 사용할 수 있는 빠른 매칭 횟수를 모두 사용했습니다.",
      });
    }

    const candidate = await getSwipeCandidate(adminClient, user.id, sex);
    return NextResponse.json({
      loggedIn: true,
      canSwipe: true,
      remaining,
      limit: dailyLimit,
      candidate,
      reason: candidate ? null : "현재 보여줄 후보가 없습니다.",
    });
  } catch (error) {
    console.error("[GET /api/dating/cards/swipe] failed", error);
    return NextResponse.json({ error: "빠른 매칭 정보를 불러오지 못했습니다." }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const { user } = await getRequestAuthContext(req);

  if (!user) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }

  const ip = extractClientIp(req);
  const rateLimit = await checkRouteRateLimit({
    requestId: crypto.randomUUID(),
    scope: "dating-cards-swipe-post",
    userId: user.id,
    ip,
    userLimitPerMin: 20,
    ipLimitPerMin: 60,
    path: "/api/dating/cards/swipe",
  });
  if (!rateLimit.allowed) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const body = (await req.json().catch(() => null)) as
    | {
        sex?: string;
        action?: SwipeAction;
        target_user_id?: string;
        target_card_id?: string;
      }
    | null;

  const sex = sanitizeSex(body?.sex ?? null);
  const action = sanitizeAction(body?.action);
  const targetUserId = String(body?.target_user_id ?? "").trim();
  const targetCardId = String(body?.target_card_id ?? "").trim();

  if (!sex || !action || !targetUserId || !targetCardId) {
    return NextResponse.json({ error: "요청 정보가 올바르지 않습니다." }, { status: 400 });
  }
  if (targetUserId === user.id) {
    return NextResponse.json({ error: "본인 카드는 빠른 매칭할 수 없습니다." }, { status: 400 });
  }

  const adminClient = createAdminClient();

  try {
    const limitInfo = await getSwipeLimitInfo(adminClient, user.id);
    const dailyLimit = limitInfo.limit;
    const myCard = await getLatestSwipeCardForUser(adminClient, user.id);
    if (!myCard) {
      return NextResponse.json({ error: "라이크나 넘기기를 하려면 먼저 오픈카드를 등록해 주세요." }, { status: 403 });
    }

    const pairKey = getPairKey(user.id, targetUserId);
    const pairMatchRes = await adminClient
      .from("dating_card_swipe_matches")
      .select("id")
      .eq("pair_key", pairKey)
      .maybeSingle();
    if (pairMatchRes.error && !isMissingRelationError(pairMatchRes.error)) {
      throw pairMatchRes.error;
    }
    const pairMatched = !pairMatchRes.error && Boolean(pairMatchRes.data);
    const expiryCutoffMs = Date.now() - SWIPE_LIKE_EXPIRY_HOURS * 60 * 60 * 1000;

    const dupRes = await adminClient
      .from("dating_card_swipes")
      .select("id, action, created_at")
      .eq("actor_user_id", user.id)
      .eq("target_user_id", targetUserId)
      .eq("target_sex", sex)
      .maybeSingle();
    if (dupRes.error) {
      throw dupRes.error;
    }

    const targetRes = await adminClient
      .from("dating_cards")
      .select("id, owner_user_id, sex, display_nickname, instagram_id, status, created_at")
      .eq("id", targetCardId)
      .maybeSingle();
    if (targetRes.error) {
      throw targetRes.error;
    }
    const targetCard = targetRes.data;
    if (!targetCard || targetCard.owner_user_id !== targetUserId || targetCard.sex !== sex) {
      return NextResponse.json({ error: "대상 카드를 찾을 수 없습니다." }, { status: 404 });
    }

    const targetProfileRes = await adminClient
      .from("profiles")
      .select("swipe_profile_visible")
      .eq("user_id", targetUserId)
      .maybeSingle();
    if (targetProfileRes.error && !targetProfileRes.error.message?.includes("swipe_profile_visible")) {
      throw targetProfileRes.error;
    }
    if (targetProfileRes.data?.swipe_profile_visible === false) {
      return NextResponse.json({ error: "상대가 빠른매칭 숨김 상태라 더 이상 진행할 수 없습니다." }, { status: 410 });
    }

    const blocked = await hasDatingBlockBetween(adminClient, user.id, targetUserId);
    if (blocked) {
      return NextResponse.json({ error: "차단한 상대에게는 빠른 매칭을 사용할 수 없습니다." }, { status: 403 });
    }
    if (!String(targetCard.instagram_id ?? "").trim()) {
      return NextResponse.json({ error: "대상 카드에 인스타 정보가 없어 진행할 수 없습니다." }, { status: 400 });
    }

    let existingSwipe = dupRes.data;
    if (existingSwipe?.action === "like") {
      const createdAtMs = new Date(String(existingSwipe.created_at ?? "")).getTime();
      if (
        isSwipeLikeExpiryEligible(String(existingSwipe.created_at ?? "")) &&
        Number.isFinite(createdAtMs) &&
        createdAtMs <= expiryCutoffMs &&
        !pairMatched
      ) {
        const staleDeleteRes = await adminClient
          .from("dating_card_swipes")
          .delete()
          .eq("id", existingSwipe.id)
          .eq("actor_user_id", user.id);
        if (staleDeleteRes.error) {
          throw staleDeleteRes.error;
        }
        existingSwipe = null;
      }
    }
    const isPassToLikeRetry = existingSwipe?.action === "pass" && action === "like";
    if (existingSwipe?.id && !isPassToLikeRetry) {
      return NextResponse.json({ error: "이미 처리한 상대입니다." }, { status: 409 });
    }

    const used = await getSwipeDailyUsage(adminClient, user.id);
    if (!existingSwipe?.id && used >= dailyLimit) {
      return NextResponse.json({ error: "오늘 사용할 수 있는 빠른 매칭 횟수를 모두 사용했습니다." }, { status: 429 });
    }

    if (existingSwipe?.id && isPassToLikeRetry) {
      const updateRes = await adminClient
        .from("dating_card_swipes")
        .update({
          actor_card_id: myCard.id,
          target_card_id: targetCardId,
          target_sex: sex,
          action: "like",
        })
        .eq("id", existingSwipe.id)
        .select("id")
        .single();

      if (updateRes.error) {
        console.error("[POST /api/dating/cards/swipe] update failed", updateRes.error);
        return NextResponse.json({ error: "빠른 매칭 처리 중 저장에 실패했습니다." }, { status: 500 });
      }
    } else {
      const insertRes = await adminClient
        .from("dating_card_swipes")
        .insert({
          actor_user_id: user.id,
          actor_card_id: myCard.id,
          target_user_id: targetUserId,
          target_card_id: targetCardId,
          target_sex: sex,
          action,
        })
        .select("id")
        .single();

      if (insertRes.error) {
        console.error("[POST /api/dating/cards/swipe] insert failed", insertRes.error);
        return NextResponse.json({ error: "빠른 매칭 처리 중 저장에 실패했습니다." }, { status: 500 });
      }
    }

    let matchPayload:
      | {
          id: string;
          other_instagram_id: string;
          other_nickname: string;
        }
      | null = null;

    if (action === "like") {
      const reverseLikeRes = await adminClient
        .from("dating_card_swipes")
        .select("id, actor_card_id, created_at")
        .eq("actor_user_id", targetUserId)
        .eq("target_user_id", user.id)
        .eq("action", "like")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (reverseLikeRes.error) {
        throw reverseLikeRes.error;
      }

      const targetNickname = String(targetCard.display_nickname ?? "회원").trim() || "회원";
      const myNickname = String(myCard.display_nickname ?? "회원").trim() || "회원";
      const sentLikeEmail = await sendDatingEmailNotification(
        adminClient,
        targetUserId,
        "빠른매칭에서 회원님에게 좋아요가 도착했어요",
        `${myNickname}님이 빠른매칭에서 회원님에게 좋아요를 눌렀어요.\n마이페이지에서 자세한 내용을 확인해 주세요.`
      );
      if (!sentLikeEmail) {
        console.info("[POST /api/dating/cards/swipe] like email skipped", {
          targetUserId,
        });
      }

      let reverseLike = reverseLikeRes.data;
      if (reverseLike?.id && !pairMatched) {
        const reverseCreatedAtMs = new Date(String(reverseLike.created_at ?? "")).getTime();
        if (
          isSwipeLikeExpiryEligible(String(reverseLike.created_at ?? "")) &&
          Number.isFinite(reverseCreatedAtMs) &&
          reverseCreatedAtMs <= expiryCutoffMs
        ) {
          const deleteReverseRes = await adminClient
            .from("dating_card_swipes")
            .delete()
            .eq("id", reverseLike.id)
            .eq("actor_user_id", targetUserId);
          if (deleteReverseRes.error) {
            throw deleteReverseRes.error;
          }
          reverseLike = null;
        }
      }

      if (reverseLike?.id) {
        const [userAId, userBId] = user.id < targetUserId ? [user.id, targetUserId] : [targetUserId, user.id];
        const userACardId = userAId === user.id ? myCard.id : targetCardId;
        const userBCardId = userBId === user.id ? myCard.id : targetCardId;
        const userAInstagramId = userAId === user.id ? myCard.instagram_id : String(targetCard.instagram_id ?? "").trim();
        const userBInstagramId = userBId === user.id ? myCard.instagram_id : String(targetCard.instagram_id ?? "").trim();

        const matchInsertRes = await adminClient
          .from("dating_card_swipe_matches")
          .upsert(
            {
              pair_key: pairKey,
              user_a_id: userAId,
              user_b_id: userBId,
              user_a_card_id: userACardId,
              user_b_card_id: userBCardId,
              user_a_instagram_id: userAInstagramId,
              user_b_instagram_id: userBInstagramId,
            },
            { onConflict: "pair_key" }
          )
          .select("id")
          .single();
        if (matchInsertRes.error) {
          throw matchInsertRes.error;
        }

        try {
          await recordDatingMatchEvent(adminClient, {
            kind: "swipe",
            sourceKey: pairKey,
            createdAt: new Date().toISOString(),
            metaJson: {
              pair_key: pairKey,
              user_a_id: userAId,
              user_b_id: userBId,
            },
          });
        } catch (metricError) {
          console.error("[POST /api/dating/cards/swipe] match metric failed", metricError);
        }

        const otherInstagramId = String(targetCard.instagram_id ?? "").trim();
        matchPayload = {
          id: matchInsertRes.data.id,
          other_instagram_id: otherInstagramId,
          other_nickname: targetNickname,
        };

        await Promise.all([
          sendDatingEmailNotification(
            adminClient,
            user.id,
            "빠른매칭 쌍방 매칭이 성사됐어요",
            `${targetNickname}님도 회원님에게 좋아요를 눌러 쌍방 매칭이 됐어요.\n상대 인스타그램: @${otherInstagramId}`
          ),
          sendDatingEmailNotification(
            adminClient,
            targetUserId,
            "빠른매칭 쌍방 매칭이 성사됐어요",
            `${myNickname}님과 빠른매칭 쌍방 매칭이 됐어요.\n사이트 마이페이지에서 상대 인스타그램 정보를 확인해 주세요.`
          ),
        ]);
      }
    }

    return NextResponse.json({
      ok: true,
      remaining: Math.max(0, dailyLimit - (used + (existingSwipe?.id ? 0 : 1))),
      limit: dailyLimit,
      match: matchPayload,
    });
  } catch (error) {
    console.error("[POST /api/dating/cards/swipe] failed", error);
    return NextResponse.json({ error: "빠른 매칭 처리 중 오류가 발생했습니다." }, { status: 500 });
  }
}


