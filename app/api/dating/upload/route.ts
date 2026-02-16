import { createClient, createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

const MAX_SIZE = 5 * 1024 * 1024; // 5MB
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"];

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }

  const formData = await request.formData();
  const file = formData.get("file") as File | null;
  const applicationId = formData.get("applicationId") as string | null;
  const index = formData.get("index") as string | null; // "0" or "1"

  if (!file || !applicationId || index == null) {
    return NextResponse.json({ error: "필수 파라미터가 누락되었습니다." }, { status: 400 });
  }

  if (!["0", "1"].includes(index)) {
    return NextResponse.json({ error: "잘못된 인덱스입니다." }, { status: 400 });
  }

  if (file.size > MAX_SIZE) {
    return NextResponse.json({ error: "5MB 이하의 파일만 업로드할 수 있습니다." }, { status: 400 });
  }

  if (!ALLOWED_TYPES.includes(file.type)) {
    return NextResponse.json({ error: "JPG, PNG, WebP만 업로드할 수 있습니다." }, { status: 400 });
  }

  const adminClient = createAdminClient();

  // 소유자 확인
  const { data: app } = await adminClient
    .from("dating_applications")
    .select("id, user_id, photo_urls")
    .eq("id", applicationId)
    .single();

  if (!app || app.user_id !== user.id) {
    return NextResponse.json({ error: "권한이 없습니다." }, { status: 403 });
  }

  const ext = file.name.split(".").pop()?.toLowerCase() ?? "jpg";
  const storagePath = `dating/${user.id}/${applicationId}/${Number(index) + 1}.${ext}`;
  const buffer = Buffer.from(await file.arrayBuffer());

  const { error: uploadError } = await adminClient.storage
    .from("dating-photos")
    .upload(storagePath, buffer, { contentType: file.type, upsert: true });

  if (uploadError) {
    console.error("[POST /api/dating/upload]", uploadError.message);
    return NextResponse.json({ error: "업로드에 실패했습니다." }, { status: 500 });
  }

  // photo_urls 업데이트
  const currentUrls: string[] = Array.isArray(app.photo_urls) ? [...app.photo_urls] : [];
  currentUrls[Number(index)] = storagePath;

  const { error: updateError } = await adminClient
    .from("dating_applications")
    .update({ photo_urls: currentUrls })
    .eq("id", applicationId);

  if (updateError) {
    console.error("[POST /api/dating/upload] update", updateError.message);
    return NextResponse.json({ error: "정보 업데이트에 실패했습니다." }, { status: 500 });
  }

  return NextResponse.json({ path: storagePath }, { status: 200 });
}
