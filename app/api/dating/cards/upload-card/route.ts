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
  if (!form) return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });

  const file = form.get("file");
  const kind = String(form.get("kind") ?? "raw");
  const index = Number(String(form.get("index") ?? "0"));
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "파일이 필요합니다." }, { status: 400 });
  }
  if (!ALLOWED_TYPES.includes(file.type)) {
    return NextResponse.json({ error: "JPG/PNG/WebP 파일만 업로드할 수 있습니다." }, { status: 400 });
  }
  if (file.size > MAX_FILE_SIZE) {
    return NextResponse.json({ error: "파일은 5MB 이하만 가능합니다." }, { status: 400 });
  }
  if (index < 0 || index > 9) {
    return NextResponse.json({ error: "index 값이 올바르지 않습니다." }, { status: 400 });
  }

  const ext = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
  const folder = kind === "blur" ? "blur" : "raw";
  const path = `cards/${user.id}/${folder}/${Date.now()}-${index}.${ext}`;

  const adminClient = createAdminClient();
  const { error } = await adminClient.storage
    .from("dating-card-photos")
    .upload(path, file, { contentType: file.type, upsert: false, cacheControl: "3600" });

  if (error) {
    console.error("[POST /api/dating/cards/upload-card] failed", error);
    return NextResponse.json({ error: "카드 사진 업로드에 실패했습니다." }, { status: 500 });
  }

  return NextResponse.json({ path }, { status: 201 });
}
