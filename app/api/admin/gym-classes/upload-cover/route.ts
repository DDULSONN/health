import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireAdminRoute } from "@/lib/admin-route";

export const runtime = "nodejs";

const BUCKET = "gym-class-covers";
const MAX_FILE_SIZE = 5 * 1024 * 1024;
const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

function getExtension(type: string) {
  if (type === "image/png") return "png";
  if (type === "image/webp") return "webp";
  return "jpg";
}

async function ensureBucket(admin: SupabaseClient) {
  const { error } = await admin.storage.createBucket(BUCKET, {
    public: true,
    fileSizeLimit: `${MAX_FILE_SIZE}`,
    allowedMimeTypes: Array.from(ALLOWED_TYPES),
  });

  if (!error) return;
  const message = String(error.message ?? "").toLowerCase();
  if (!message.includes("already") && !message.includes("duplicate")) {
    throw error;
  }
}

export async function POST(req: Request) {
  const auth = await requireAdminRoute();
  if (!auth.ok) return auth.response;

  const form = await req.formData().catch(() => null);
  if (!form) {
    return NextResponse.json({ error: "요청 형식이 올바르지 않습니다." }, { status: 400 });
  }

  const file = form.get("file");
  const operatorId = String(form.get("operator_id") ?? "admin").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 80) || "admin";

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "사진 파일을 선택해 주세요." }, { status: 400 });
  }

  if (!ALLOWED_TYPES.has(file.type)) {
    return NextResponse.json({ error: "JPG, PNG, WebP 파일만 업로드할 수 있습니다." }, { status: 400 });
  }

  if (file.size > MAX_FILE_SIZE) {
    return NextResponse.json({ error: "사진은 5MB 이하만 업로드할 수 있습니다." }, { status: 400 });
  }

  try {
    await ensureBucket(auth.admin);
    const path = `covers/${operatorId}/${Date.now()}-${crypto.randomUUID()}.${getExtension(file.type)}`;
    const { error } = await auth.admin.storage.from(BUCKET).upload(path, file, {
      contentType: file.type,
      cacheControl: "31536000",
      upsert: false,
    });

    if (error) {
      return NextResponse.json({ error: "사진 업로드에 실패했습니다.", detail: error.message }, { status: 500 });
    }

    const { data } = auth.admin.storage.from(BUCKET).getPublicUrl(path);
    return NextResponse.json({ url: data.publicUrl, path });
  } catch (error) {
    return NextResponse.json(
      { error: "사진 업로드에 실패했습니다.", detail: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
