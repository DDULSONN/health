import { createAdminClient } from "@/lib/supabase/server";
import { getRequestAuthContext } from "@/lib/supabase/request";
import { NextResponse } from "next/server";
import sharp from "sharp";
import { ensureAllowedMutationOrigin } from "@/lib/request-origin";

export const runtime = "nodejs";

const BUCKET = "dating-1on1-photos";
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

async function ensureBucket(adminClient: ReturnType<typeof createAdminClient>) {
  const { error } = await adminClient.storage.createBucket(BUCKET, {
    public: false,
    fileSizeLimit: `${MAX_FILE_SIZE}`,
    allowedMimeTypes: ["image/jpeg", "image/png", "image/webp"],
  });

  if (!error) return;
  const message = (error.message ?? "").toLowerCase();
  if (message.includes("already") || message.includes("duplicate")) return;
  throw error;
}

export async function POST(req: Request) {
  const originResponse = ensureAllowedMutationOrigin(req);
  if (originResponse) return originResponse;

  const { user } = await getRequestAuthContext(req);

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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
      { error: "HEIC 사진은 지원하지 않아요. 사진을 캡처해서 다시 올리거나 JPG/PNG/WebP로 선택해 주세요." },
      { status: 400 }
    );
  }

  if (!ALLOWED_TYPES.has(fileType) && !ALLOWED_EXTENSIONS.has(fileExtension)) {
    return NextResponse.json(
      { error: "JPG, PNG, WebP 사진만 업로드할 수 있어요. 안 되면 사진을 캡처해서 다시 올려주세요." },
      { status: 400 }
    );
  }

  if (file.size > MAX_FILE_SIZE) {
    return NextResponse.json(
      { error: "사진은 12MB 이하만 업로드할 수 있어요. 캡처해서 올리면 보통 해결됩니다." },
      { status: 400 }
    );
  }

  let webpBytes: Buffer;
  try {
    webpBytes = await sharp(Buffer.from(await file.arrayBuffer()))
      .rotate()
      .resize({ width: 1200, withoutEnlargement: true, fit: "inside" })
      .webp({ quality: 72 })
      .toBuffer();
  } catch (error) {
    console.error("[POST /api/dating/1on1/upload] image processing failed", error);
    return NextResponse.json(
      { error: "사진을 처리하지 못했습니다. 다른 사진이나 캡처한 사진으로 다시 올려주세요." },
      { status: 400 }
    );
  }

  const path = `cards/${user.id}/${Date.now()}-${crypto.randomUUID()}.webp`;
  const admin = createAdminClient();

  let uploadRes = await admin.storage.from(BUCKET).upload(path, webpBytes, {
    contentType: "image/webp",
    upsert: false,
    cacheControl: "1200",
  });

  if (uploadRes.error) {
    const lower = (uploadRes.error.message ?? "").toLowerCase();
    if (lower.includes("bucket") && lower.includes("not")) {
      await ensureBucket(admin);
      uploadRes = await admin.storage.from(BUCKET).upload(path, webpBytes, {
        contentType: "image/webp",
        upsert: false,
        cacheControl: "1200",
      });
    }
  }

  if (uploadRes.error) {
    console.error("[POST /api/dating/1on1/upload] upload failed", uploadRes.error);
    return NextResponse.json({ error: "사진 업로드에 실패했습니다. 잠시 후 다시 시도해 주세요." }, { status: 500 });
  }

  return NextResponse.json({ path }, { status: 201 });
}
