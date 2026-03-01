import { checkRouteRateLimit, extractClientIp } from "@/lib/request-rate-limit";
import {
  getLatestSwipeCardForUser,
  getSwipeCandidate,
  getSwipeDailyUsage,
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
      reason: "?棺??짆????????⑤챶裕???????怨?????덊렡.",
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
    return NextResponse.json({ error: "?濚밸Ŧ援???????筌?? ?????????덊렡." }, { status: 400 });
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
        reason: "????딄묻?怨멸텭????ｏ쭗????????⑤?彛??濚밸Ŧ援욃ㅇ?????????????⑤챶裕???????怨?????덊렡.",
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
        reason: "????몄툜 ??繹먮끏???????꾨탿????筌먲퐣???癲ル슢?꾤땟?嶺???????怨?????덊렡.",
      });
    }

    const candidate = await getSwipeCandidate(adminClient, user.id, sex);
    return NextResponse.json({
      loggedIn: true,
      canSwipe: true,
      remaining,
      limit: SWIPE_DAILY_LIMIT,
      candidate,
      reason: candidate ? null : "??ш끽維???怨뚮옖???덩?????ш끽維亦낅쉠琉??쎛 ???⑤８?????덊렡.",
    });
  } catch (error) {
    console.error("[GET /api/dating/cards/swipe] failed", error);
    return NextResponse.json({ error: "?????熬곣뫀????ш끽維亦????됰씭????? 癲ル슢履뉑쾮?彛??????" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "?棺??짆??嶺뚮ㅎ?닻???ш끽維???筌뤾퍓???" }, { status: 401 });
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
    return NextResponse.json({ error: "??釉먯뒜????좊즴???????筌?? ?????????덊렡." }, { status: 400 });
  }
  if (targetUserId === user.id) {
    return NextResponse.json({ error: "?怨뚮옖筌???怨멸텭????癲ル슪?ｇ몭????????⑤８?????덊렡." }, { status: 400 });
  }

  const adminClient = createAdminClient();

  try {
    const myCard = await getLatestSwipeCardForUser(adminClient, user.id);
    if (!myCard) {
      return NextResponse.json({ error: "????딄묻?怨멸텭????????????怨쀪퐨?????⑤챶裕???????怨?????덊렡." }, { status: 403 });
    }

    const used = await getSwipeDailyUsage(adminClient, user.id);
    if (used >= SWIPE_DAILY_LIMIT) {
      return NextResponse.json({ error: "????몄툜 ??繹먮끏???????꾨탿????筌먲퐣???癲ル슢?꾤땟?嶺???????怨?????덊렡." }, { status: 429 });
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
      return NextResponse.json({ error: "???? 癲ル슪?ｇ몭??????????낇돲??" }, { status: 409 });
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
      return NextResponse.json({ error: "??? ?怨멸텭????ｏ쭗?癲ル슓??젆???????⑤８?????덊렡." }, { status: 404 });
    }
    if (!String(targetCard.instagram_id ?? "").trim()) {
      return NextResponse.json({ error: "??? ?嶺뚮ㅎ?ц짆?? ?嶺뚮㉡?€쾮戮る쨬??쎛 ???⑤８?????덊렡." }, { status: 400 });
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
      return NextResponse.json({ error: "?????熬곣뫀???????묎덩?????됰꽡???怨?????덊렡." }, { status: 500 });
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

      const targetNickname = String(targetCard.display_nickname ?? "Someone").trim() || "Someone";
      const sentLikeEmail = await sendDatingEmailNotification(
        adminClient,
        targetUserId,
        "New like on your open card",
        `${myCard.display_nickname ?? "Someone"} liked your open card.` + "`n" + "Check the site for details."
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
            "New auto match on open cards",
            `You and ${targetNickname} liked each other.` + "`n" + `Other Instagram: @${otherInstagramId}`
          ),
          sendDatingEmailNotification(
            adminClient,
            targetUserId,
            "New auto match on open cards",
            `You and ${myCard.display_nickname ?? "Someone"} liked each other.` + "`n" + "Check the site mypage for Instagram details.",
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
    return NextResponse.json({ error: "?????熬곣뫀??癲ル슪?ｇ몭???????됰꽡???怨?????덊렡." }, { status: 500 });
  }
}
