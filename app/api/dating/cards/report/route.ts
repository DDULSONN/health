import { createClient, createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

function sanitize(value: unknown, maxLength: number) {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, maxLength);
}

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });

  const cardId = sanitize((body as { card_id?: unknown }).card_id, 100);
  const reason = sanitize((body as { reason?: unknown }).reason, 1000);
  if (!cardId || !reason) {
    return NextResponse.json({ error: "card_id/reason이 필요합니다." }, { status: 400 });
  }

  const adminClient = createAdminClient();
  const { data: card } = await adminClient
    .from("dating_cards")
    .select("id, status")
    .eq("id", cardId)
    .maybeSingle();
  if (!card || card.status !== "public") {
    return NextResponse.json({ error: "신고 가능한 카드가 아닙니다." }, { status: 404 });
  }

  const { error } = await adminClient.from("dating_card_reports").upsert(
    {
      card_id: cardId,
      reporter_user_id: user.id,
      reason,
    },
    { onConflict: "card_id,reporter_user_id" }
  );
  if (error) {
    console.error("[POST /api/dating/cards/report] failed", error);
    return NextResponse.json({ error: "신고 접수에 실패했습니다." }, { status: 500 });
  }
  return NextResponse.json({ ok: true }, { status: 201 });
}
