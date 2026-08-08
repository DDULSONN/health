import { recordAdminAuditEvent } from "@/lib/admin-audit";
import { requireAdminRoute } from "@/lib/admin-route";
import { ensureBlurThumbFromRaw } from "@/lib/dating-blur-thumb";
import { ensureAllowedMutationOrigin } from "@/lib/request-origin";
import { NextResponse } from "next/server";
import sharp from "sharp";

export const runtime = "nodejs";

const CARD_BUCKET = "dating-card-photos";
const MAX_FILE_SIZE = 12 * 1024 * 1024;
const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const requestId = crypto.randomUUID();
  const originResponse = ensureAllowedMutationOrigin(req);
  if (originResponse) return originResponse;

  const guard = await requireAdminRoute();
  if (!guard.ok) return guard.response;

  const { id } = await params;
  const cardId = id.trim();
  const formData = await req.formData().catch(() => null);
  const file = formData?.get("file");
  const slot = Number(formData?.get("slot"));

  if (!cardId || !(file instanceof File) || !Number.isInteger(slot) || slot < 0 || slot > 1) {
    return NextResponse.json({ ok: false, error: "카드, 사진, 슬롯 정보를 확인해 주세요." }, { status: 400 });
  }
  if (!ALLOWED_TYPES.has(file.type)) {
    return NextResponse.json({ ok: false, error: "JPG, PNG, WebP 사진만 올릴 수 있습니다." }, { status: 400 });
  }
  if (file.size <= 0 || file.size > MAX_FILE_SIZE) {
    return NextResponse.json({ ok: false, error: "사진은 장당 12MB 이하만 올릴 수 있습니다." }, { status: 400 });
  }

  const cardRes = await guard.admin
    .from("dating_paid_cards")
    .select("id,user_id,photo_paths,photo_visibility,blur_thumb_path,status")
    .eq("id", cardId)
    .maybeSingle();
  if (cardRes.error) {
    console.error(`[admin-paid-photo] ${requestId} card read failed`, cardRes.error);
    return NextResponse.json({ ok: false, error: "유료카드를 불러오지 못했습니다." }, { status: 500 });
  }
  if (!cardRes.data) {
    return NextResponse.json({ ok: false, error: "유료카드를 찾지 못했습니다." }, { status: 404 });
  }

  const currentPaths = Array.isArray(cardRes.data.photo_paths)
    ? cardRes.data.photo_paths.filter((path): path is string => typeof path === "string" && path.length > 0).slice(0, 2)
    : [];
  if (slot === 1 && !currentPaths[0]) {
    return NextResponse.json({ ok: false, error: "사진 1을 먼저 등록해 주세요." }, { status: 409 });
  }

  let bytes: Buffer;
  try {
    bytes = await sharp(Buffer.from(await file.arrayBuffer()))
      .rotate()
      .resize({ width: 1800, height: 2400, fit: "inside", withoutEnlargement: true })
      .webp({ quality: 82 })
      .toBuffer();
  } catch (error) {
    console.error(`[admin-paid-photo] ${requestId} image processing failed`, error);
    return NextResponse.json({ ok: false, error: "사진을 처리하지 못했습니다. 다른 사진으로 다시 시도해 주세요." }, { status: 400 });
  }

  const storagePath = `cards/${cardRes.data.user_id}/raw/admin-${cardId}-${slot}-${crypto.randomUUID()}.webp`;
  const uploadRes = await guard.admin.storage.from(CARD_BUCKET).upload(storagePath, bytes, {
    contentType: "image/webp",
    cacheControl: "3600",
    upsert: false,
  });
  if (uploadRes.error) {
    console.error(`[admin-paid-photo] ${requestId} upload failed`, uploadRes.error);
    return NextResponse.json({ ok: false, error: "사진 업로드에 실패했습니다." }, { status: 500 });
  }

  let nextBlurThumbPath = typeof cardRes.data.blur_thumb_path === "string" ? cardRes.data.blur_thumb_path : "";
  if (slot === 0 && cardRes.data.photo_visibility !== "public") {
    nextBlurThumbPath = (await ensureBlurThumbFromRaw(guard.admin, storagePath)) ?? "";
    if (!nextBlurThumbPath) {
      await guard.admin.storage.from(CARD_BUCKET).remove([storagePath]);
      return NextResponse.json({ ok: false, error: "블러 사진 생성에 실패했습니다. 다시 시도해 주세요." }, { status: 500 });
    }
  }

  const nextPaths = [...currentPaths];
  nextPaths[slot] = storagePath;
  const updateRes = await guard.admin
    .from("dating_paid_cards")
    .update({
      photo_paths: nextPaths,
      ...(slot === 0 && cardRes.data.photo_visibility !== "public"
        ? { blur_thumb_path: nextBlurThumbPath }
        : {}),
    })
    .eq("id", cardId)
    .select("id,user_id,photo_paths,blur_thumb_path")
    .maybeSingle();
  if (updateRes.error || !updateRes.data) {
    console.error(`[admin-paid-photo] ${requestId} update failed`, updateRes.error);
    await guard.admin.storage.from(CARD_BUCKET).remove([storagePath]);
    return NextResponse.json({ ok: false, error: "카드 사진 정보를 저장하지 못했습니다." }, { status: 500 });
  }

  await recordAdminAuditEvent({
    admin: guard.admin,
    adminUser: guard.user,
    request: req,
    action: "dating_paid_card_photo_updated",
    targetType: "dating_paid_card",
    targetId: cardId,
    requestId,
    metadata: {
      owner_user_id: cardRes.data.user_id,
      slot,
      previous_photo_count: currentPaths.length,
      next_photo_count: nextPaths.length,
      status: cardRes.data.status,
    },
  });

  return NextResponse.json({ ok: true, item: updateRes.data });
}
