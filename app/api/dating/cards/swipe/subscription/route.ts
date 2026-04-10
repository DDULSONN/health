import { getLatestSwipeCardForUser, getSwipeLimitInfo } from "@/lib/dating-swipe";
import { getRequestAuthContext } from "@/lib/supabase/request";
import { createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

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

function toPayload(limitInfo: Awaited<ReturnType<typeof getSwipeLimitInfo>>) {
  return {
    ok: true,
    status: limitInfo.activeSubscription ? "active" : limitInfo.pendingSubscription ? "pending" : "none",
    dailyLimit: limitInfo.limit,
    baseLimit: limitInfo.baseLimit,
    premiumLimit: limitInfo.premiumLimit,
    priceKrw: limitInfo.premiumPriceKrw,
    durationDays: limitInfo.premiumDurationDays,
    activeSubscription: limitInfo.activeSubscription,
    pendingSubscription: limitInfo.pendingSubscription,
  };
}

export async function GET(req: Request) {
  const { user } = await getRequestAuthContext(req);
  if (!user) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }

  try {
    const admin = createAdminClient();
    const limitInfo = await getSwipeLimitInfo(admin, user.id);
    return NextResponse.json(toPayload(limitInfo));
  } catch (error) {
    console.error("[GET /api/dating/cards/swipe/subscription] failed", error);
    return NextResponse.json({ error: "빠른매칭 구매 상태를 불러오지 못했습니다." }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const requestId = crypto.randomUUID();
  const { user } = await getRequestAuthContext(req);
  if (!user) {
    return NextResponse.json({ ok: false, requestId, message: "로그인이 필요합니다." }, { status: 401 });
  }

  const admin = createAdminClient();

  try {
    const myCard = await getLatestSwipeCardForUser(admin, user.id);
    if (!myCard) {
      return NextResponse.json(
        { ok: false, requestId, message: "오픈카드를 등록한 사용자만 빠른매칭 라이크 구매를 신청할 수 있습니다." },
        { status: 403 }
      );
    }

    const limitInfo = await getSwipeLimitInfo(admin, user.id);
    if (limitInfo.activeSubscription) {
      return NextResponse.json({
        ...toPayload(limitInfo),
        requestId,
        message: "이미 빠른매칭 라이크 플랜을 이용 중입니다.",
      });
    }
    if (limitInfo.pendingSubscription) {
      return NextResponse.json({
        ...toPayload(limitInfo),
        requestId,
        message: "이미 승인 대기 중인 구매 신청이 있습니다.",
      });
    }

    const insertRes = await admin
      .from("dating_swipe_subscription_requests")
      .insert({
        user_id: user.id,
        status: "pending",
        amount: limitInfo.premiumPriceKrw,
        daily_limit: limitInfo.premiumLimit,
        duration_days: limitInfo.premiumDurationDays,
      })
      .select("id,requested_at")
      .single();

    if (insertRes.error) {
      if (isMissingRelationError(insertRes.error)) {
        return NextResponse.json(
          { ok: false, requestId, message: "빠른매칭 구매 기능 설정이 아직 적용되지 않았습니다." },
          { status: 503 }
        );
      }
      console.error("[POST /api/dating/cards/swipe/subscription] insert failed", insertRes.error);
      return NextResponse.json({ ok: false, requestId, message: "구매 신청 생성에 실패했습니다." }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      requestId,
      message: "구매 신청이 접수되었습니다. 오픈카톡으로 닉네임과 신청ID를 보내주세요.",
      status: "pending",
      dailyLimit: limitInfo.baseLimit,
      baseLimit: limitInfo.baseLimit,
      premiumLimit: limitInfo.premiumLimit,
      priceKrw: limitInfo.premiumPriceKrw,
      durationDays: limitInfo.premiumDurationDays,
      pendingSubscription: {
        id: insertRes.data.id,
        requestedAt: insertRes.data.requested_at ?? null,
      },
      activeSubscription: null,
    });
  } catch (error) {
    console.error("[POST /api/dating/cards/swipe/subscription] failed", error);
    return NextResponse.json({ ok: false, requestId, message: "빠른매칭 구매 신청 중 오류가 발생했습니다." }, { status: 500 });
  }
}
