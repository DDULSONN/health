import { NextResponse } from "next/server";
import { ensureAllowedMutationOrigin } from "@/lib/request-origin";
import { getRequestAuthContext } from "@/lib/supabase/request";
import { createAdminClient } from "@/lib/supabase/server";
import { isSwipeDismissalsSchemaMissing } from "@/lib/dating-swipe-dismissals";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const originResponse = ensureAllowedMutationOrigin(req);
  if (originResponse) return originResponse;
  const { user } = await getRequestAuthContext(req);
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  const { id } = await params;
  const body = await req.json().catch(() => null) as { created_at?: unknown } | null;
  const createdAt = typeof body?.created_at === "string" ? body.created_at : "";
  if (!UUID.test(id) || !createdAt || createdAt.length > 40 || !Number.isFinite(Date.parse(createdAt))) {
    return NextResponse.json({ error: "라이크 정보가 올바르지 않습니다." }, { status: 400 });
  }

  try {
    const admin = createAdminClient();
    const result = await admin.from("dating_card_swipes")
      .select("id, created_at")
      .eq("id", id)
      .eq("target_user_id", user.id)
      .eq("action", "like")
      .eq("created_at", createdAt)
      .maybeSingle();
    if (result.error) throw result.error;
    if (!result.data) {
      return NextResponse.json({ error: "이미 정리되었거나 변경된 라이크입니다. 목록을 다시 확인해 주세요." }, { status: 404 });
    }

    // Preserve the original swipe, daily usage, sender history, matches and chats.
    // Snapshot the version so a genuinely new like is not hidden by an old dismissal.
    const saved = await admin.from("dating_swipe_incoming_dismissals").upsert({
      user_id: user.id,
      swipe_id: result.data.id,
      swipe_created_at: result.data.created_at,
    }, { onConflict: "user_id,swipe_id,swipe_created_at", ignoreDuplicates: true });
    if (saved.error) {
      if (isSwipeDismissalsSchemaMissing(saved.error)) {
        return NextResponse.json({ error: "삭제 기능을 준비 중입니다. 잠시 후 다시 시도해 주세요." }, { status: 503 });
      }
      // The original like may have expired or been withdrawn during this request.
      if (saved.error.code === "23503") {
        return NextResponse.json({ error: "이미 정리된 라이크입니다. 목록을 다시 확인해 주세요." }, { status: 404 });
      }
      throw saved.error;
    }
    return NextResponse.json({ ok: true, removed: true }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    console.error("[DELETE /api/dating/cards/my/incoming-swipes/[id]] failed", error);
    return NextResponse.json({ error: "삭제하지 못했습니다. 잠시 후 다시 시도해 주세요." }, { status: 500 });
  }
}
