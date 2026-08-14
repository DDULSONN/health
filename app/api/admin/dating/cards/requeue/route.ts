import { NextResponse } from "next/server";
import { requireAdminRoute } from "@/lib/admin-route";
import { grantOpenCardRepost } from "@/lib/dating-purchase-fulfillment";

function json(status: number, payload: Record<string, unknown>) {
  return NextResponse.json(payload, { status });
}

export async function POST(req: Request) {
  const auth = await requireAdminRoute();
  if (!auth.ok) return auth.response;

  const body = (await req.json().catch(() => null)) as {
    userId?: unknown;
    cardId?: unknown;
  } | null;
  const userId = typeof body?.userId === "string" ? body.userId.trim() : "";
  const cardId = typeof body?.cardId === "string" ? body.cardId.trim() : "";

  if (!userId || !cardId) {
    return json(400, { ok: false, error: "회원과 오픈카드 정보가 필요합니다." });
  }

  try {
    const profileRes = await auth.admin
      .from("profiles")
      .select("user_id,is_banned")
      .eq("user_id", userId)
      .maybeSingle();
    if (profileRes.error) throw profileRes.error;
    if (!profileRes.data) {
      return json(404, { ok: false, error: "회원을 찾지 못했습니다." });
    }
    if (profileRes.data.is_banned === true) {
      return json(409, { ok: false, error: "벤 상태인 회원의 오픈카드는 재등록할 수 없습니다." });
    }

    const card = await grantOpenCardRepost(auth.admin, {
      cardId,
      userId,
      note: `admin:${auth.user.id}`,
    });

    return json(200, {
      ok: true,
      card,
      message: "기존 오픈카드를 대기열에 다시 등록했습니다.",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "오픈카드 재등록에 실패했습니다.";
    console.error("[POST /api/admin/dating/cards/requeue] failed", { userId, cardId, error });

    const status =
      message.includes("찾지 못했습니다")
        ? 404
        : message.includes("만료되었거나") || message.includes("이미 대기 중이거나")
          ? 409
          : 500;
    return json(status, { ok: false, error: message });
  }
}
