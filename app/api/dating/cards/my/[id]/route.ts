import { NextResponse } from "next/server";

import { getRequestAuthContext } from "@/lib/supabase/request";
import { createAdminClient } from "@/lib/supabase/server";
import { ensureAllowedMutationOrigin } from "@/lib/request-origin";

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
