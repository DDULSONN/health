import { ensureAllowedMutationOrigin } from "@/lib/request-origin";
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

function getPairKey(a: string, b: string): string {
  return [a, b].sort().join(":");
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const originResponse = ensureAllowedMutationOrigin(req);
  if (originResponse) return originResponse;

  const { user } = await getRequestAuthContext(req);
  if (!user) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }

  const { id } = await params;
  const swipeId = id?.trim();
  if (!swipeId) {
    return NextResponse.json({ error: "라이크 ID가 필요합니다." }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data: swipe, error: swipeError } = await admin
    .from("dating_card_swipes")
    .select("id, actor_user_id, target_user_id, action")
    .eq("id", swipeId)
    .eq("actor_user_id", user.id)
    .maybeSingle();

  if (swipeError) {
    console.error("[DELETE /api/dating/cards/my/swipes/[id]] fetch failed", swipeError);
    return NextResponse.json({ error: "라이크 정보를 불러오지 못했습니다." }, { status: 500 });
  }

  if (!swipe) {
    return NextResponse.json({ error: "라이크를 찾을 수 없습니다." }, { status: 404 });
  }

  const pairKey = getPairKey(user.id, String(swipe.target_user_id ?? ""));
  const { error: deleteSwipeError } = await admin
    .from("dating_card_swipes")
    .delete()
    .eq("id", swipeId)
    .eq("actor_user_id", user.id);

  if (deleteSwipeError) {
    console.error("[DELETE /api/dating/cards/my/swipes/[id]] delete failed", deleteSwipeError);
    return NextResponse.json({ error: "라이크 취소에 실패했습니다." }, { status: 500 });
  }

  let matchRemoved = false;
  const deleteMatchRes = await admin
    .from("dating_card_swipe_matches")
    .delete()
    .eq("pair_key", pairKey);

  if (deleteMatchRes.error && !isMissingRelationError(deleteMatchRes.error)) {
    console.error("[DELETE /api/dating/cards/my/swipes/[id]] delete match failed", deleteMatchRes.error);
    return NextResponse.json({ error: "라이크는 취소됐지만 연결 해제에 실패했습니다." }, { status: 500 });
  }

  if (!deleteMatchRes.error) {
    matchRemoved = true;
  }

  return NextResponse.json({
    ok: true,
    removed: true,
    matchRemoved,
    message: matchRemoved ? "라이크와 쌍방 매칭이 함께 취소되었습니다." : "라이크가 취소되었습니다.",
  });
}
