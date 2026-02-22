import { createClient, createAdminClient } from "@/lib/supabase/server";
import { hasMoreViewAccess } from "@/lib/dating-more-view";
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
    return NextResponse.json({ error: "濡쒓렇?몄씠 ?꾩슂?⑸땲??" }, { status: 401 });
  }

  const form = await req.formData().catch(() => null);
  if (!form) {
    return NextResponse.json({ error: "?섎せ???붿껌?낅땲??" }, { status: 400 });
  }

  const file = form.get("file");
  const cardId = String(form.get("cardId") ?? "");
  const index = Number(String(form.get("index") ?? "0"));
  if (!(file instanceof File) || !cardId) {
    return NextResponse.json({ error: "file/cardId媛 ?꾩슂?⑸땲??" }, { status: 400 });
  }

  if (!ALLOWED_TYPES.includes(file.type)) {
    return NextResponse.json({ error: "JPG/PNG/WebP ?뚯씪留??낅줈?쒗븷 ???덉뒿?덈떎." }, { status: 400 });
  }
  if (file.size > MAX_FILE_SIZE) {
    return NextResponse.json({ error: "?뚯씪? 5MB ?댄븯留?媛?ν빀?덈떎." }, { status: 400 });
  }
  if (index < 0 || index > 9) {
    return NextResponse.json({ error: "index 媛믪씠 ?щ컮瑜댁? ?딆뒿?덈떎." }, { status: 400 });
  }

  const adminClient = createAdminClient();
  const { data: card, error: cardError } = await adminClient
    .from("dating_cards")
    .select("id, status, owner_user_id, sex, expires_at")
    .eq("id", cardId)
    .single();

  if (cardError || !card) {
    return NextResponse.json({ error: "移대뱶瑜?李얠쓣 ???놁뒿?덈떎." }, { status: 404 });
  }
  if (card.owner_user_id === user.id) {
    return NextResponse.json({ error: "蹂몄씤 移대뱶?먮뒗 吏?먰븷 ???놁뒿?덈떎." }, { status: 400 });
  }
  let allowedByMoreView = false;
  if (card.status === "pending") {
    allowedByMoreView = await hasMoreViewAccess(adminClient, user.id, card.sex);
  }
  if (card.status !== "public" && !allowedByMoreView) {
    return NextResponse.json({ error: "지원 가능한 카드가 아닙니다." }, { status: 400 });
  }
  if (card.status === "public" && (!card.expires_at || new Date(card.expires_at).getTime() <= Date.now())) {
    return NextResponse.json({ error: "카드가 만료되었습니다." }, { status: 410 });
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
    return NextResponse.json({ error: "?ъ쭊 ?낅줈?쒖뿉 ?ㅽ뙣?덉뒿?덈떎." }, { status: 500 });
  }

  return NextResponse.json({ path }, { status: 201 });
}
