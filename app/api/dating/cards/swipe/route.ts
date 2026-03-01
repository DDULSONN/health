import { checkRouteRateLimit, extractClientIp } from "@/lib/request-rate-limit";
import {
  getLatestSwipeCardForUser,
  getSwipeCandidate,
  getSwipeDailyUsage,
  isSwipeEligibleStatus,
  sendDatingEmailNotification,
  SWIPE_DAILY_LIMIT,
} from "@/lib/dating-swipe";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

type SwipeAction = "like" | "pass";

function getPairKey(a: string, b: string): string {
  return [a, b].sort().join(":");
}

function sanitizeSex(value: string | null): "male" | "female" | null {
  return value === "male" || value === "female" ? value : null;
}

function sanitizeAction(value: unknown): SwipeAction | null {
  return value === "like" || value === "pass" ? value : null;
}

export async function GET(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({
      loggedIn: false,
      canSwipe: false,
      remaining: 0,
      limit: SWIPE_DAILY_LIMIT,
      candidate: null,
      reason: "로그인 후 이용할 수 있습니다.",
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
    return NextResponse.json({ error: "성별이 올바르지 않습니다." }, { status: 400 });
  }

  const adminClient = createAdminClient();

  try {
    const myCard = await getLatestSwipeCardForUser(adminClient, user.id);
    if (!myCard) {
      return NextResponse.json({
        loggedIn: true,
        canSwipe: false,
        remaining: 0,
        limit: SWIPE_DAILY_LIMIT,
        candidate: null,
        reason: "오픈카드를 한 번 이상 등록한 사용자만 이용할 수 있습니다.",
      });
    }

    const used = await getSwipeDailyUsage(adminClient, user.id);
    const remaining = Math.max(0, SWIPE_DAILY_LIMIT - used);
    if (remaining <= 0) {
      return NextResponse.json({
        loggedIn: true,
        canSwipe: false,
        remaining,
        limit: SWIPE_DAILY_LIMIT,
        candidate: null,
        reason: "오늘 라이크/넘기기 한도를 모두 사용했습니다.",
      });
    }

    const candidate = await getSwipeCandidate(adminClient, user.id, sex);
    return NextResponse.json({
      loggedIn: true,
      canSwipe: true,
      remaining,
      limit: SWIPE_DAILY_LIMIT,
      candidate,
      reason: candidate ? null : "현재 보여줄 후보가 없습니다.",
    });
  } catch (error) {
    console.error("[GET /api/dating/cards/swipe] failed", error);
    return NextResponse.json({ error: "스와이프 후보를 불러오지 못했습니다." }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

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
    return NextResponse.json({ error: "요청 값이 올바르지 않습니다." }, { status: 400 });
  }
  if (targetUserId === user.id) {
    return NextResponse.json({ error: "본인 카드는 처리할 수 없습니다." }, { status: 400 });
  }

  const adminClient = createAdminClient();

  try {
    const myCard = await getLatestSwipeCardForUser(adminClient, user.id);
    if (!myCard) {
      return NextResponse.json({ error: "오픈카드 이력이 있어야 이용할 수 있습니다." }, { status: 403 });
    }

    const used = await getSwipeDailyUsage(adminClient, user.id);
    if (used >= SWIPE_DAILY_LIMIT) {
      return NextResponse.json({ error: "오늘 라이크/넘기기 한도를 모두 사용했습니다." }, { status: 429 });
    }

    const dupRes = await adminClient
      .from("dating_card_swipes")
      .select("id")
      .eq("actor_user_id", user.id)
      .eq("target_user_id", targetUserId)
      .eq("target_sex", sex)
      .maybeSingle();
    if (dupRes.error) {
      throw dupRes.error;
    }
    if (dupRes.data?.id) {
      return NextResponse.json({ error: "이미 처리한 상대입니다." }, { status: 409 });
    }

    const targetRes = await adminClient
      .from("dating_cards")
      .select(
        "id, owner_user_id, sex, display_nickname, instagram_id, status, created_at"
      )
      .eq("id", targetCardId)
      .maybeSingle();
    if (targetRes.error) {
      throw targetRes.error;
    }
    const targetCard = targetRes.data;
    if (!targetCard || targetCard.owner_user_id !== targetUserId || targetCard.sex !== sex) {
      return NextResponse.json({ error: "상대 카드를 찾을 수 없습니다." }, { status: 404 });
    }
    if (!isSwipeEligibleStatus(targetCard.status)) {
      return NextResponse.json({ error: "현재 처리할 수 없는 카드입니다." }, { status: 409 });
    }
    if (!String(targetCard.instagram_id ?? "").trim()) {
      return NextResponse.json({ error: "상대 인스타 정보가 없습니다." }, { status: 400 });
    }

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
      return NextResponse.json({ error: "스와이프 저장에 실패했습니다." }, { status: 500 });
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
        .select("id, actor_card_id")
        .eq("actor_user_id", targetUserId)
        .eq("target_user_id", user.id)
        .eq("action", "like")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (reverseLikeRes.error) {
        throw reverseLikeRes.error;
      }

      const targetNickname = String(targetCard.display_nickname ?? "익명").trim() || "익명";
      const sentLikeEmail = await sendDatingEmailNotification(
        adminClient,
        targetUserId,
        "새 라이크가 도착했습니다",
        `${myCard.display_nickname ?? "익명"}님이 회원님의 오픈카드에 라이크를 보냈습니다.\n사이트에서 확인해보세요.`
      );
      if (!sentLikeEmail) {
        console.info("[POST /api/dating/cards/swipe] like email skipped", {
          targetUserId,
        });
      }

      if (reverseLikeRes.data?.id) {
        const pairKey = getPairKey(user.id, targetUserId);
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
            "오픈카드 자동 매칭이 성사되었습니다",
            `${targetNickname}님과 서로 라이크하여 자동 매칭되었습니다.\n상대 인스타: @${otherInstagramId}`
          ),
          sendDatingEmailNotification(
            adminClient,
            targetUserId,
            "오픈카드 자동 매칭이 성사되었습니다",
            `${myCard.display_nickname ?? "익명"}님과 서로 라이크하여 자동 매칭되었습니다.\n사이트 마이페이지에서 인스타를 확인해보세요.`
          ),
        ]);
      }
    }

    return NextResponse.json({
      ok: true,
      remaining: Math.max(0, SWIPE_DAILY_LIMIT - (used + 1)),
      match: matchPayload,
    });
  } catch (error) {
    console.error("[POST /api/dating/cards/swipe] failed", error);
    return NextResponse.json({ error: "스와이프 처리에 실패했습니다." }, { status: 500 });
  }
}
