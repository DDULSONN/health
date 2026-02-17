import { isAdminEmail } from "@/lib/admin";
import { OPEN_CARD_EXPIRE_HOURS, OPEN_CARD_LIMIT_PER_SEX } from "@/lib/dating-open";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

function isMissingColumnError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = String((error as { code?: unknown }).code ?? "");
  const message = String((error as { message?: unknown }).message ?? "").toLowerCase();
  return code === "42703" || code === "PGRST204" || message.includes("could not find") || message.includes("column");
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user || !isAdminEmail(user.email)) {
    return NextResponse.json({ error: "권한이 없습니다." }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const status = (body as { status?: string } | null)?.status;
  if (status !== "pending" && status !== "public" && status !== "hidden" && status !== "expired") {
    return NextResponse.json({ error: "허용되지 않은 상태값입니다." }, { status: 400 });
  }

  const adminClient = createAdminClient();
  const { data: card, error: cardError } = await adminClient
    .from("dating_cards")
    .select("id, sex")
    .eq("id", id)
    .single();

  if (cardError || !card) {
    return NextResponse.json({ error: "카드를 찾을 수 없습니다." }, { status: 404 });
  }

  const updatePayload: {
    status: "pending" | "public" | "hidden" | "expired";
    published_at?: string | null;
    expires_at?: string | null;
  } = { status };

  if (status === "public") {
    let { count, error: slotError } = await adminClient
      .from("dating_cards")
      .select("id", { count: "exact", head: true })
      .eq("sex", card.sex)
      .eq("status", "public")
      .gt("expires_at", new Date().toISOString());

    // Legacy fallback when expires_at column is not available yet.
    if (slotError && isMissingColumnError(slotError)) {
      const legacy = await adminClient
        .from("dating_cards")
        .select("id", { count: "exact", head: true })
        .eq("sex", card.sex)
        .eq("status", "public");
      count = legacy.count;
      slotError = legacy.error;
    }

    if (slotError) {
      console.error("[PATCH /api/admin/dating/cards/[id]] slot count failed", slotError);
      return NextResponse.json({ error: "공개 슬롯 확인에 실패했습니다." }, { status: 500 });
    }

    if ((count ?? 0) >= OPEN_CARD_LIMIT_PER_SEX) {
      return NextResponse.json(
        { error: "현재 공개 슬롯이 가득 찼어요. 대기열에 등록해주세요.", code: "PUBLIC_SLOT_FULL" },
        { status: 409 }
      );
    }

    const now = new Date();
    updatePayload.published_at = now.toISOString();
    updatePayload.expires_at = new Date(now.getTime() + OPEN_CARD_EXPIRE_HOURS * 60 * 60 * 1000).toISOString();
  } else if (status === "pending") {
    updatePayload.published_at = null;
    updatePayload.expires_at = null;
  } else if (status === "hidden" || status === "expired") {
    updatePayload.expires_at = new Date().toISOString();
  }

  let updateRes = await adminClient.from("dating_cards").update(updatePayload).eq("id", id);
  if (updateRes.error && isMissingColumnError(updateRes.error)) {
    // Legacy fallback when published_at / expires_at columns are absent.
    updateRes = await adminClient.from("dating_cards").update({ status }).eq("id", id);
  }

  if (updateRes.error) {
    console.error("[PATCH /api/admin/dating/cards/[id]] failed", updateRes.error);
    return NextResponse.json({ error: "상태 변경에 실패했습니다." }, { status: 500 });
  }

  return NextResponse.json({ ok: true, status });
}