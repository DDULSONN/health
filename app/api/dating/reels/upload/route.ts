import { ensureAllowedMutationOrigin } from "@/lib/request-origin";
import { createAdminClient } from "@/lib/supabase/server";
import { getRequestAuthContext } from "@/lib/supabase/request";
import { NextResponse } from "next/server";
import sharp from "sharp";

export const runtime = "nodejs";

const BUCKET = "reels-dating-application-photos";
const MAX_FILE_SIZE = 12 * 1024 * 1024;
const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const ALLOWED_EXTENSIONS = new Set(["jpg", "jpeg", "png", "webp"]);
const UNSUPPORTED_IPHONE_PHOTO_TYPES = new Set(["image/heic", "image/heif"]);
const UNSUPPORTED_IPHONE_PHOTO_EXTENSIONS = new Set(["heic", "heif"]);

function getFileExtension(fileName: string) {
  const normalized = fileName.trim().toLowerCase();
  const idx = normalized.lastIndexOf(".");
  return idx >= 0 ? normalized.slice(idx + 1) : "";
}

function isMissingColumnError(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const code = String((error as { code?: unknown }).code ?? "");
  const message = String((error as { message?: unknown }).message ?? "").toLowerCase();
  return code === "42703" || code === "PGRST204" || message.includes("could not find") || message.includes("column");
}

async function ensureBucket(adminClient: ReturnType<typeof createAdminClient>) {
  const { error } = await adminClient.storage.createBucket(BUCKET, {
    public: false,
    fileSizeLimit: `${MAX_FILE_SIZE}`,
    allowedMimeTypes: ["image/webp"],
  });

  if (!error) return;
  const message = (error.message ?? "").toLowerCase();
  const alreadyExists = message.includes("already") || message.includes("duplicate");
  if (!alreadyExists) throw error;
}

export async function POST(req: Request) {
  const originError = ensureAllowedMutationOrigin(req);
  if (originError) return originError;

  const { user } = await getRequestAuthContext(req);
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  const admin = createAdminClient();
  let profileRes = await admin
    .from("profiles")
    .select("phone_verified")
    .eq("user_id", user.id)
    .limit(1)
    .maybeSingle();

  if ((profileRes.error && isMissingColumnError(profileRes.error)) || (!profileRes.error && !profileRes.data)) {
    profileRes = await admin.from("profiles").select("phone_verified").eq("id", user.id).limit(1).maybeSingle();
  }

  if (profileRes.error) {
    console.error("[POST /api/dating/reels/upload] profile failed", profileRes.error);
    return NextResponse.json({ error: "회원 정보를 확인하지 못했습니다." }, { status: 500 });
  }
  if (profileRes.data?.phone_verified !== true) {
    return NextResponse.json({ error: "휴대폰 번호 인증 후 업로드할 수 있습니다." }, { status: 403 });
  }

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "사진 파일이 필요합니다." }, { status: 400 });
  }

  const fileType = file.type.toLowerCase();
  const fileExtension = getFileExtension(file.name);

  if (UNSUPPORTED_IPHONE_PHOTO_TYPES.has(fileType) || UNSUPPORTED_IPHONE_PHOTO_EXTENSIONS.has(fileExtension)) {
    return NextResponse.json(
      { error: "HEIC 사진은 지원하지 않아요. 캡처하거나 JPG/PNG/WebP로 바꿔서 올려주세요." },
      { status: 400 }
    );
  }
  if (!ALLOWED_TYPES.has(fileType) && !ALLOWED_EXTENSIONS.has(fileExtension)) {
    return NextResponse.json({ error: "JPG, PNG, WebP 사진만 올릴 수 있습니다." }, { status: 400 });
  }
  if (file.size > MAX_FILE_SIZE) {
    return NextResponse.json({ error: "사진은 12MB 이하만 업로드할 수 있습니다." }, { status: 400 });
  }

  let bytes: Buffer;
  try {
    bytes = await sharp(Buffer.from(await file.arrayBuffer()))
      .rotate()
      .resize({ width: 1000, withoutEnlargement: true, fit: "inside" })
      .webp({ quality: 72 })
      .toBuffer();
  } catch (error) {
    console.error("[POST /api/dating/reels/upload] image processing failed", error);
    return NextResponse.json({ error: "사진을 처리하지 못했습니다. 다른 사진으로 다시 올려주세요." }, { status: 400 });
  }

  await ensureBucket(admin);

  const path = `applications/${user.id}/${Date.now()}-${crypto.randomUUID()}.webp`;
  const uploadRes = await admin.storage.from(BUCKET).upload(path, bytes, {
    contentType: "image/webp",
    cacheControl: "31536000",
    upsert: false,
  });

  if (uploadRes.error) {
    console.error("[POST /api/dating/reels/upload] upload failed", uploadRes.error);
    return NextResponse.json({ error: "사진 업로드에 실패했습니다." }, { status: 500 });
  }

  return NextResponse.json({ path });
}
