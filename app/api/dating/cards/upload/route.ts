import { createAdminClient } from "@/lib/supabase/server";
import { hasMoreViewAccess } from "@/lib/dating-more-view";
import { hasCityViewAccess } from "@/lib/dating-city-view";
import { NextResponse } from "next/server";
import { getRequestAuthContext } from "@/lib/supabase/request";
import { ensureAllowedMutationOrigin } from "@/lib/request-origin";

export const runtime = "nodejs";

const MAX_FILE_SIZE = 10 * 1024 * 1024;
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"];
const HEIC_TYPES = ["image/heic", "image/heif"];

export async function POST(req: Request) {
  const originResponse = ensureAllowedMutationOrigin(req);
  if (originResponse) return originResponse;

  const { user } = await getRequestAuthContext(req);

  if (!user) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }

  const form = await req.formData().catch(() => null);
  if (!form) {
    return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });
  }

  const file = form.get("file");
  const cardId = String(form.get("cardId") ?? "");
  const index = Number(String(form.get("index") ?? "0"));
  if (!(file instanceof File) || !cardId) {
    return NextResponse.json({ error: "사진 파일과 카드 정보가 필요합니다." }, { status: 400 });
  }

  if (HEIC_TYPES.includes(file.type)) {
    return NextResponse.json(
      { error: "HEIC 사진은 아직 지원하지 않아요. JPG, PNG, WebP 형식으로 다시 업로드해 주세요." },
      { status: 400 }
    );
  }

  if (!ALLOWED_TYPES.includes(file.type)) {
    return NextResponse.json({ error: "사진은 JPG, PNG, WebP 형식만 업로드할 수 있어요." }, { status: 400 });
  }
  if (file.size > MAX_FILE_SIZE) {
    return NextResponse.json({ error: "사진은 10MB 이하만 업로드할 수 있어요." }, { status: 400 });
  }
  if (index < 0 || index > 9) {
    return NextResponse.json({ error: "사진 순서 정보가 올바르지 않습니다." }, { status: 400 });
  }

  const adminClient = createAdminClient();
  const { data: card, error: cardError } = await adminClient
    .from("dating_cards")
    .select("id, status, owner_user_id, sex, region, expires_at")
    .eq("id", cardId)
    .single();

  if (cardError || !card) {
    return NextResponse.json({ error: "지원할 오픈카드를 찾지 못했습니다." }, { status: 404 });
  }
  if (card.owner_user_id === user.id) {
    return NextResponse.json({ error: "본인 오픈카드에는 지원할 수 없습니다." }, { status: 400 });
  }

  let allowedByMoreView = false;
  let allowedByCityView = false;
  if (card.status === "pending") {
    allowedByMoreView = await hasMoreViewAccess(adminClient, user.id, card.sex);
    allowedByCityView = await hasCityViewAccess(adminClient, user.id, card.region ?? null);
  }

  if (card.status !== "public" && !allowedByMoreView && !allowedByCityView) {
    return NextResponse.json({ error: "지금은 지원할 수 없는 오픈카드입니다." }, { status: 400 });
  }
  if (card.status === "public" && (!card.expires_at || new Date(card.expires_at).getTime() <= Date.now())) {
    return NextResponse.json({ error: "이 오픈카드는 이미 마감되었습니다." }, { status: 410 });
  }

  const ext = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
  const path = `card-applications/${user.id}/${cardId}/${Date.now()}-${index}.${ext}`;

  const { error: uploadError } = await adminClient.storage.from("dating-apply-photos").upload(path, file, {
    contentType: file.type,
    upsert: false,
    cacheControl: "3600",
  });

  if (uploadError) {
    console.error("[POST /api/dating/cards/upload] failed", uploadError);
    return NextResponse.json(
      {
        error: `사진 업로드에 실패했습니다. 잠시 후 다시 시도해 주세요.${uploadError.message ? ` (${uploadError.message})` : ""}`,
      },
      { status: 500 }
    );
  }

  return NextResponse.json({ path }, { status: 201 });
}
