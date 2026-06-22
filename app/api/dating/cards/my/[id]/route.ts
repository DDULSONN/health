import { NextResponse } from "next/server";

import { ensureAllowedMutationOrigin } from "@/lib/request-origin";
import { getRequestAuthContext } from "@/lib/supabase/request";
import { createAdminClient } from "@/lib/supabase/server";

function normalizePhotoVisibility(value: unknown): "blur" | "public" | null {
  return value === "blur" || value === "public" ? value : null;
}

function hasTwoStoredPhotos(value: unknown): boolean {
  return Array.isArray(value) && value.filter((item) => typeof item === "string" && item.trim().length > 0).length >= 2;
}

function hasBlurPreview(value: unknown, fallbackThumb: unknown): boolean {
  if (hasTwoStoredPhotos(value)) return true;
  return typeof fallbackThumb === "string" && fallbackThumb.trim().length > 0;
}

function isMissingColumnError(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const code = "code" in error ? String(error.code ?? "") : "";
  return code === "42703" || code === "PGRST204";
}

async function reactivateOpenCard(cardId: string, userId: string) {
  const adminClient = createAdminClient();
  const cardRes = await adminClient
    .from("dating_cards")
    .select("id,owner_user_id,status")
    .eq("id", cardId)
    .maybeSingle();

  if (cardRes.error || !cardRes.data || cardRes.data.owner_user_id !== userId) {
    return NextResponse.json({ error: "오픈카드를 찾을 수 없습니다." }, { status: 404 });
  }

  const currentStatus = String(cardRes.data.status ?? "");
  if (currentStatus !== "expired" && currentStatus !== "hidden") {
    return NextResponse.json({ error: "만료되었거나 내려간 오픈카드만 다시 대기 등록할 수 있습니다." }, { status: 400 });
  }

  const activeCardRes = await adminClient
    .from("dating_cards")
    .select("id")
    .eq("owner_user_id", userId)
    .in("status", ["pending", "public"])
    .neq("id", cardId)
    .limit(1)
    .maybeSingle();

  if (activeCardRes.error) {
    console.error("[PATCH /api/dating/cards/my/[id]] active card check failed", activeCardRes.error);
    return NextResponse.json({ error: "기존 오픈카드 상태를 확인하지 못했습니다." }, { status: 500 });
  }
  if (activeCardRes.data) {
    return NextResponse.json({ error: "이미 대기중이거나 공개중인 오픈카드가 있습니다." }, { status: 409 });
  }

  const nowIso = new Date().toISOString();
  let updateRes = await adminClient
    .from("dating_cards")
    .update({
      status: "pending",
      published_at: null,
      expires_at: null,
      queue_priority_at: nowIso,
      auto_requeue_count: 0,
    })
    .eq("id", cardId)
    .eq("owner_user_id", userId)
    .in("status", ["expired", "hidden"])
    .select("id,status")
    .maybeSingle();

  if (updateRes.error && isMissingColumnError(updateRes.error)) {
    updateRes = await adminClient
      .from("dating_cards")
      .update({
        status: "pending",
        published_at: null,
        expires_at: null,
      })
      .eq("id", cardId)
      .eq("owner_user_id", userId)
      .in("status", ["expired", "hidden"])
      .select("id,status")
      .maybeSingle();
  }

  if (updateRes.error || !updateRes.data) {
    console.error("[PATCH /api/dating/cards/my/[id]] reactivate failed", updateRes.error);
    return NextResponse.json({ error: "오픈카드를 다시 대기 등록하지 못했습니다." }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    id: updateRes.data.id,
    status: updateRes.data.status,
    message: "기존 오픈카드를 다시 대기열에 등록했습니다.",
  });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const originResponse = ensureAllowedMutationOrigin(req);
  if (originResponse) return originResponse;

  const { user } = await getRequestAuthContext(req);
  if (!user) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }

  const { id } = await params;
  const cardId = String(id ?? "").trim();
  if (!cardId) {
    return NextResponse.json({ error: "오픈카드 ID가 필요합니다." }, { status: 400 });
  }

  const body = await req.json().catch(() => null);
  if ((body as { action?: unknown } | null)?.action === "hide") {
    const adminClient = createAdminClient();
    const cardRes = await adminClient
      .from("dating_cards")
      .select("id,owner_user_id,status")
      .eq("id", cardId)
      .maybeSingle();

    if (cardRes.error || !cardRes.data || cardRes.data.owner_user_id !== user.id) {
      return NextResponse.json({ error: "오픈카드를 찾을 수 없습니다." }, { status: 404 });
    }

    if (String(cardRes.data.status ?? "") !== "public") {
      return NextResponse.json({ error: "공개 중인 오픈카드만 내릴 수 있습니다." }, { status: 400 });
    }

    const nowIso = new Date().toISOString();
    const updateRes = await adminClient
      .from("dating_cards")
      .update({ status: "hidden", expires_at: nowIso })
      .eq("id", cardId)
      .eq("owner_user_id", user.id)
      .eq("status", "public")
      .select("id,status,expires_at")
      .maybeSingle();

    if (updateRes.error || !updateRes.data) {
      console.error("[PATCH /api/dating/cards/my/[id]] hide failed", updateRes.error);
      return NextResponse.json({ error: "오픈카드 내리기에 실패했습니다." }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      id: updateRes.data.id,
      status: updateRes.data.status,
      expires_at: updateRes.data.expires_at,
      message: "오픈카드를 내렸습니다. 필요하면 재등록권으로 다시 올릴 수 있습니다.",
    });
  }

  if ((body as { action?: unknown } | null)?.action === "reactivate") {
    return reactivateOpenCard(cardId, user.id);
  }

  const photoVisibility = normalizePhotoVisibility((body as { photo_visibility?: unknown } | null)?.photo_visibility);
  if (!photoVisibility) {
    return NextResponse.json({ error: "사진 공개 설정을 확인해 주세요." }, { status: 400 });
  }

  const adminClient = createAdminClient();
  const cardRes = await adminClient
    .from("dating_cards")
    .select("id,owner_user_id,status,photo_paths,blur_paths,blur_thumb_path")
    .eq("id", cardId)
    .maybeSingle();

  if (cardRes.error || !cardRes.data || cardRes.data.owner_user_id !== user.id) {
    return NextResponse.json({ error: "오픈카드를 찾을 수 없습니다." }, { status: 404 });
  }

  if (String(cardRes.data.status ?? "") !== "public") {
    return NextResponse.json({ error: "공개중인 오픈카드만 사진 공개 설정을 바꿀 수 있습니다." }, { status: 400 });
  }

  if (photoVisibility === "public" && !hasTwoStoredPhotos(cardRes.data.photo_paths)) {
    return NextResponse.json({ error: "원본 사진 정보가 부족해 블러 해제를 할 수 없습니다." }, { status: 400 });
  }
  if (photoVisibility === "blur" && !hasBlurPreview(cardRes.data.blur_paths, cardRes.data.blur_thumb_path)) {
    return NextResponse.json({ error: "블러 이미지 정보가 부족해 블러 처리를 할 수 없습니다." }, { status: 400 });
  }

  const updateRes = await adminClient
    .from("dating_cards")
    .update({ photo_visibility: photoVisibility })
    .eq("id", cardId)
    .eq("owner_user_id", user.id)
    .eq("status", "public")
    .select("id,status,photo_visibility")
    .maybeSingle();

  if (updateRes.error || !updateRes.data) {
    console.error("[PATCH /api/dating/cards/my/[id]] visibility failed", updateRes.error);
    return NextResponse.json({ error: "사진 공개 설정 변경에 실패했습니다." }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    id: updateRes.data.id,
    status: updateRes.data.status,
    photo_visibility: updateRes.data.photo_visibility === "public" ? "public" : "blur",
    message: photoVisibility === "public" ? "사진을 블러 없이 공개합니다." : "사진을 블러 처리합니다.",
  });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { user } = await getRequestAuthContext(_req);
  if (!user) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }

  const { id } = await params;
  const cardId = String(id ?? "").trim();
  if (!cardId) {
    return NextResponse.json({ error: "삭제할 오픈카드 ID가 필요합니다." }, { status: 400 });
  }

  const adminClient = createAdminClient();
  const cardRes = await adminClient
    .from("dating_cards")
    .select("id,owner_user_id,status")
    .eq("id", cardId)
    .maybeSingle();

  if (cardRes.error || !cardRes.data || cardRes.data.owner_user_id !== user.id) {
    return NextResponse.json({ error: "오픈카드를 찾을 수 없습니다." }, { status: 404 });
  }

  if (!["pending", "public", "expired", "hidden"].includes(String(cardRes.data.status ?? ""))) {
    return NextResponse.json({ error: "지금은 삭제할 수 없는 오픈카드 상태입니다." }, { status: 400 });
  }

  const deleteRes = await adminClient
    .from("dating_cards")
    .delete()
    .eq("id", cardId)
    .eq("owner_user_id", user.id);

  if (deleteRes.error) {
    console.error("[DELETE /api/dating/cards/my/[id]] failed", deleteRes.error);
    return NextResponse.json({ error: "오픈카드 삭제에 실패했습니다." }, { status: 500 });
  }

  return NextResponse.json({ ok: true, id: cardId, message: "오픈카드를 삭제했습니다." });
}
