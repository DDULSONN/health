import { createClient, createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

const MAX_FILE_SIZE = 5 * 1024 * 1024;
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"];

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

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
    return NextResponse.json({ error: "file/cardId가 필요합니다." }, { status: 400 });
  }

  if (!ALLOWED_TYPES.includes(file.type)) {
    return NextResponse.json({ error: "JPG/PNG/WebP만 업로드할 수 있습니다." }, { status: 400 });
  }
  if (file.size > MAX_FILE_SIZE) {
    return NextResponse.json({ error: "파일은 5MB 이하만 가능합니다." }, { status: 400 });
  }
  if (index < 0 || index > 9) {
    return NextResponse.json({ error: "index가 올바르지 않습니다." }, { status: 400 });
  }

  const adminClient = createAdminClient();
  const { data: card, error: cardError } = await adminClient
    .from("dating_cards")
    .select("id, status, owner_user_id")
    .eq("id", cardId)
    .single();
  if (cardError || !card) {
    return NextResponse.json({ error: "카드를 찾을 수 없습니다." }, { status: 404 });
  }
  if (card.status !== "public") {
    return NextResponse.json({ error: "지원 가능한 카드가 아닙니다." }, { status: 400 });
  }
  if (card.owner_user_id === user.id) {
    return NextResponse.json({ error: "본인 카드에는 지원할 수 없습니다." }, { status: 400 });
  }

  const ext = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
  const path = `card-applications/${user.id}/${cardId}/${Date.now()}-${index}.${ext}`;

  const { error: uploadError } = await adminClient.storage
    .from("dating-photos")
    .upload(path, file, {
      contentType: file.type,
      upsert: false,
      cacheControl: "3600",
    });

  if (uploadError) {
    console.error("[POST /api/dating/cards/upload] failed", uploadError);
    return NextResponse.json({ error: "사진 업로드에 실패했습니다." }, { status: 500 });
  }

  return NextResponse.json({ path }, { status: 201 });
}
