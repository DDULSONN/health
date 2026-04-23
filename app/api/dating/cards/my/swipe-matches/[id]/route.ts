import { ensureAllowedMutationOrigin } from "@/lib/request-origin";
import { getRequestAuthContext } from "@/lib/supabase/request";
import { createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

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
  const matchId = id?.trim();
  if (!matchId) {
    return NextResponse.json({ error: "매칭 ID가 필요합니다." }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data: match, error: matchError } = await admin
    .from("dating_card_swipe_matches")
    .select("id,pair_key,user_a_id,user_b_id")
    .eq("id", matchId)
    .maybeSingle();

  if (matchError) {
    console.error("[DELETE /api/dating/cards/my/swipe-matches/[id]] fetch failed", matchError);
    return NextResponse.json({ error: "매칭 정보를 불러오지 못했습니다." }, { status: 500 });
  }

  if (!match || (match.user_a_id !== user.id && match.user_b_id !== user.id)) {
    return NextResponse.json({ error: "매칭을 찾을 수 없습니다." }, { status: 404 });
  }

  const { error: deleteSwipesError } = await admin
    .from("dating_card_swipes")
    .delete()
    .or(
      `and(actor_user_id.eq.${match.user_a_id},target_user_id.eq.${match.user_b_id}),and(actor_user_id.eq.${match.user_b_id},target_user_id.eq.${match.user_a_id})`
    );

  if (deleteSwipesError) {
    console.error("[DELETE /api/dating/cards/my/swipe-matches/[id]] delete swipes failed", deleteSwipesError);
    return NextResponse.json({ error: "자동 매칭 삭제에 실패했습니다." }, { status: 500 });
  }

  const { error: deleteMatchError } = await admin
    .from("dating_card_swipe_matches")
    .delete()
    .eq("id", match.id);

  if (deleteMatchError) {
    console.error("[DELETE /api/dating/cards/my/swipe-matches/[id]] delete match failed", deleteMatchError);
    return NextResponse.json({ error: "자동 매칭 삭제에 실패했습니다." }, { status: 500 });
  }

  const { error: deleteThreadError } = await admin
    .from("dating_chat_threads")
    .delete()
    .eq("source_kind", "swipe")
    .eq("source_id", match.id);

  if (deleteThreadError) {
    console.error("[DELETE /api/dating/cards/my/swipe-matches/[id]] delete thread failed", deleteThreadError);
    return NextResponse.json({ error: "자동 매칭은 삭제됐지만 채팅 정리에 실패했습니다." }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    message: "자동 매칭과 인스타 교환 목록에서 삭제했습니다.",
  });
}
