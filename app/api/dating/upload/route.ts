import { createClient, createAdminClient } from "@/lib/supabase/server";
import type { PostgrestError } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

const MAX_SIZE = 5 * 1024 * 1024; // 5MB
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"];
const ALLOWED_EXTENSIONS = new Set(["jpg", "jpeg", "png", "webp"]);

function getExtension(fileName: string): string {
  const ext = fileName.split(".").pop()?.toLowerCase();
  return ext && ext.length > 0 ? ext : "";
}

function formatDbError(error: PostgrestError | { name?: string; message?: string; details?: string | null }): string {
  const details = "details" in error ? (error.details ?? null) : null;
  return [
    error.name ? `[${error.name}]` : null,
    error.message ?? null,
    details ?? null,
  ]
    .filter(Boolean)
    .join(" | ");
}

function jsonError(status: number, error: string, code: string, details?: string) {
  return NextResponse.json({ error, code, details }, { status });
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return jsonError(401, "로그인이 필요합니다.", "AUTH_REQUIRED");
  }

  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return jsonError(500, "서버 설정이 올바르지 않습니다.", "CONFIG_ERROR");
  }

  const formData = await request.formData();
  const file = formData.get("file") as File | null;
  const applicationId = formData.get("applicationId") as string | null;
  const index = formData.get("index") as string | null; // "0" or "1"

  if (!file || !applicationId || index == null) {
    return jsonError(400, "필수 파라미터가 누락되었습니다.", "MISSING_PARAMS");
  }

  if (!["0", "1"].includes(index)) {
    return jsonError(400, "잘못된 인덱스입니다.", "INVALID_INDEX");
  }

  if (file.size > MAX_SIZE) {
    return jsonError(400, "5MB 이하의 파일만 업로드할 수 있습니다.", "FILE_TOO_LARGE");
  }

  const ext = getExtension(file.name) || "jpg";
  if (!ALLOWED_TYPES.includes(file.type) || !ALLOWED_EXTENSIONS.has(ext)) {
    return jsonError(400, "JPG, PNG, WebP만 업로드할 수 있습니다. (HEIC 불가)", "UNSUPPORTED_FILE_TYPE");
  }

  const adminClient = createAdminClient();

  // 소유자 확인
  const { data: app, error: appError } = await adminClient
    .from("dating_applications")
    .select("id, user_id, photo_urls, thumb_blur_path")
    .eq("id", applicationId)
    .single();

  if (appError) {
    console.error("[POST /api/dating/upload] app read failed", appError);
    return jsonError(500, "신청 정보 조회에 실패했습니다.", "APP_READ_FAILED", formatDbError(appError));
  }

  if (!app || app.user_id !== user.id) {
    return jsonError(403, "권한이 없습니다.", "FORBIDDEN");
  }

  const storagePath = `dating/${user.id}/${applicationId}/${Number(index) + 1}.${ext}`;
  const buffer = Buffer.from(await file.arrayBuffer());

  const { error: uploadError } = await adminClient.storage
    .from("dating-photos")
    .upload(storagePath, buffer, { contentType: file.type, upsert: true });

  if (uploadError) {
    console.error("[POST /api/dating/upload] storage upload failed", uploadError);
    return jsonError(500, "업로드에 실패했습니다.", "STORAGE_UPLOAD_FAILED", formatDbError(uploadError));
  }

  // photo_urls 업데이트
  const currentUrls: string[] = Array.isArray(app.photo_urls) ? [...app.photo_urls] : [];
  currentUrls[Number(index)] = storagePath;
  const updatePayload: { photo_urls: string[]; thumb_blur_path?: string } = { photo_urls: currentUrls };

  // 첫 번째 업로드 파일을 기본 썸네일 경로로 기록
  if (Number(index) === 0 && (!app.thumb_blur_path || String(app.thumb_blur_path).trim().length === 0)) {
    updatePayload.thumb_blur_path = storagePath;
  }

  const { error: updateError } = await adminClient
    .from("dating_applications")
    .update(updatePayload)
    .eq("id", applicationId);

  if (updateError) {
    console.error("[POST /api/dating/upload] update failed", updateError);
    return jsonError(500, "정보 업데이트에 실패했습니다.", "APP_UPDATE_FAILED", formatDbError(updateError));
  }

  return NextResponse.json({ path: storagePath }, { status: 200 });
}
