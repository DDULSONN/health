import { ensureBlurThumbFromRaw } from "@/lib/dating-blur-thumb";
import { requireAdminRoute } from "@/lib/admin-route";
import { extractStorageObjectPathFromBuckets } from "@/lib/images";
import { NextResponse } from "next/server";

type RepairBlurBody = {
  paidCardId?: unknown;
};

function json(status: number, payload: Record<string, unknown>) {
  return NextResponse.json(payload, { status });
}

function normalizeDatingPhotoPath(raw: unknown): string {
  if (typeof raw !== "string") return "";
  const value = raw.trim();
  if (!value) return "";
  return extractStorageObjectPathFromBuckets(value, ["dating-card-photos", "dating-photos"]) ?? value;
}

export async function POST(req: Request) {
  const requestId = crypto.randomUUID();

  const adminGuard = await requireAdminRoute();
  if (!adminGuard.ok) return adminGuard.response;

  const body = ((await req.json().catch(() => null)) ?? {}) as RepairBlurBody;
  const paidCardId = typeof body.paidCardId === "string" ? body.paidCardId.trim() : "";
  if (!paidCardId) {
    return json(400, { ok: false, code: "VALIDATION_ERROR", requestId, message: "paidCardId가 필요합니다." });
  }

  const { admin } = adminGuard;
  const cardRes = await admin
    .from("dating_paid_cards")
    .select("id,photo_visibility,blur_thumb_path,photo_paths")
    .eq("id", paidCardId)
    .maybeSingle();

  if (cardRes.error || !cardRes.data) {
    return json(404, { ok: false, code: "NOT_FOUND", requestId, message: "유료 카드를 찾을 수 없습니다." });
  }

  const rawPaths = Array.isArray(cardRes.data.photo_paths)
    ? cardRes.data.photo_paths
        .map((item) => normalizeDatingPhotoPath(item))
        .filter((item) => item.length > 0)
    : [];

  if (rawPaths.length === 0) {
    return json(400, {
      ok: false,
      code: "NO_RAW_PHOTO",
      requestId,
      message: "원본 사진이 없어 블러 썸네일을 복구할 수 없습니다.",
    });
  }

  const blurThumbPath = (await ensureBlurThumbFromRaw(admin, rawPaths[0])) ?? "";

  if (!blurThumbPath) {
    return json(500, {
      ok: false,
      code: "BLUR_REPAIR_FAILED",
      requestId,
      message: "블러 썸네일 생성에 실패했습니다.",
    });
  }

  const updateRes = await admin
    .from("dating_paid_cards")
    .update({
      photo_visibility: "blur",
      blur_thumb_path: blurThumbPath,
    })
    .eq("id", paidCardId)
    .select("id,photo_visibility,blur_thumb_path")
    .single();

  if (updateRes.error || !updateRes.data) {
    return json(500, {
      ok: false,
      code: "UPDATE_FAILED",
      requestId,
      message: "블러 복구 상태 저장에 실패했습니다.",
    });
  }

  return json(200, {
    ok: true,
    requestId,
    item: updateRes.data,
    message: "블러 복구가 완료되었습니다.",
  });
}
