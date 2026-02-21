import { createClient, createAdminClient } from "@/lib/supabase/server";
import { checkRouteRateLimit, extractClientIp } from "@/lib/request-rate-limit";
import { NextResponse } from "next/server";

const MAX_SIZE = 5 * 1024 * 1024; // 5MB
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];

/** POST /api/upload — 이미지 업로드 (Supabase Storage) */
export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json(
      { error: "로그인이 필요합니다." },
      { status: 401 }
    );
  }
  const ip = extractClientIp(request);
  const rateLimit = await checkRouteRateLimit({
    requestId,
    scope: "community-upload",
    userId: user.id,
    ip,
    userLimitPerMin: 20,
    ipLimitPerMin: 80,
    path: "/api/upload",
  });
  if (!rateLimit.allowed) {
    return NextResponse.json({ error: "요청이 너무 많습니다. 잠시 후 다시 시도해 주세요." }, { status: 429 });
  }

  const formData = await request.formData();
  const file = formData.get("file") as File | null;

  if (!file) {
    return NextResponse.json({ error: "파일이 없습니다." }, { status: 400 });
  }

  if (file.size > MAX_SIZE) {
    return NextResponse.json(
      { error: "5MB 이하의 파일만 업로드할 수 있습니다." },
      { status: 400 }
    );
  }

  if (!ALLOWED_TYPES.includes(file.type)) {
    return NextResponse.json(
      { error: "JPG, PNG, WebP, GIF만 업로드할 수 있습니다." },
      { status: 400 }
    );
  }

  const ext = file.name.split(".").pop()?.toLowerCase() ?? "jpg";
  const path = `${user.id}/${crypto.randomUUID()}.${ext}`;
  const buffer = Buffer.from(await file.arrayBuffer());

  // admin 클라이언트로 업로드 (Storage RLS 우회)
  const adminSupabase = await createAdminClient();
  const { error } = await adminSupabase.storage
    .from("community")
    .upload(path, buffer, { contentType: file.type, upsert: false });

  if (error) {
    console.error("[POST /api/upload]", error.message);
    return NextResponse.json(
      { error: "업로드에 실패했습니다." },
      { status: 500 }
    );
  }

  const {
    data: { publicUrl },
  } = adminSupabase.storage.from("community").getPublicUrl(path);

  return NextResponse.json({ url: publicUrl });
}
