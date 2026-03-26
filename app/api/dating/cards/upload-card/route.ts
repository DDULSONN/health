import { createAdminClient } from "@/lib/supabase/server";
import { kvSetString } from "@/lib/edge-kv";
import { getRequestAuthContext } from "@/lib/supabase/request";
import { NextResponse } from "next/server";
import sharp from "sharp";
import { ensureAllowedMutationOrigin } from "@/lib/request-origin";

export const runtime = "nodejs";

const MAX_FILE_SIZE = 5 * 1024 * 1024;
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"];
const CARD_BUCKET = "dating-card-photos";
const LITE_PUBLIC_BUCKET = "dating-card-lite";
const THUMB_WIDTH = 560;
const THUMB_QUALITY = 68;
const BLUR_WIDTH = 560;
const BLUR_QUALITY = 68;

async function ensureCardBucket(adminClient: ReturnType<typeof createAdminClient>) {
  const { error } = await adminClient.storage.createBucket(CARD_BUCKET, {
    public: false,
    fileSizeLimit: `${MAX_FILE_SIZE}`,
    allowedMimeTypes: ALLOWED_TYPES,
  });

  if (!error) return;

  const message = (error.message ?? "").toLowerCase();
  const alreadyExists = message.includes("already") || message.includes("duplicate");
  if (!alreadyExists) {
    throw error;
  }
}

async function ensureLitePublicBucket(adminClient: ReturnType<typeof createAdminClient>) {
  const { error } = await adminClient.storage.createBucket(LITE_PUBLIC_BUCKET, {
    public: true,
    fileSizeLimit: `${MAX_FILE_SIZE}`,
    allowedMimeTypes: ALLOWED_TYPES,
  });

  if (!error) return;

  const message = (error.message ?? "").toLowerCase();
  const alreadyExists = message.includes("already") || message.includes("duplicate");
  if (!alreadyExists) {
    throw error;
  }
}

async function uploadCardPhoto(
  adminClient: ReturnType<typeof createAdminClient>,
  path: string,
  file: File,
  override?: { contentType: string; bytes: Buffer }
) {
  const payload = override?.bytes ?? file;
  const contentType = override?.contentType ?? file.type;
  const firstTry = await adminClient.storage.from(CARD_BUCKET).upload(path, payload, {
    contentType,
    upsert: false,
    cacheControl: "3600",
  });

  if (!firstTry.error) return { error: null as null | { message?: string } };

  const message = (firstTry.error.message ?? "").toLowerCase();
  const bucketMissing = message.includes("bucket") && message.includes("not");
  if (!bucketMissing) return { error: firstTry.error };

  await ensureCardBucket(adminClient);

  const secondTry = await adminClient.storage.from(CARD_BUCKET).upload(path, payload, {
    contentType,
    upsert: false,
    cacheControl: "3600",
  });

  return { error: secondTry.error };
}

async function uploadLitePublicPhoto(
  adminClient: ReturnType<typeof createAdminClient>,
  path: string,
  file: File,
  override?: { contentType: string; bytes: Buffer }
) {
  const payload = override?.bytes ?? file;
  const contentType = override?.contentType ?? file.type;
  const firstTry = await adminClient.storage.from(LITE_PUBLIC_BUCKET).upload(path, payload, {
    contentType,
    upsert: false,
    cacheControl: "31536000",
  });

  if (!firstTry.error) return { error: null as null | { message?: string } };

  const message = (firstTry.error.message ?? "").toLowerCase();
  const bucketMissing = message.includes("bucket") && message.includes("not");
  if (!bucketMissing) return { error: firstTry.error };

  await ensureLitePublicBucket(adminClient);

  const secondTry = await adminClient.storage.from(LITE_PUBLIC_BUCKET).upload(path, payload, {
    contentType,
    upsert: false,
    cacheControl: "31536000",
  });

  return { error: secondTry.error };
}

function toThumbPath(litePath: string): string {
  return litePath.replace("/lite/", "/thumb/").replace(/\.[^.\/]+$/, ".webp");
}

async function toBlurWebpBytes(file: File): Promise<Buffer> {
  const input = Buffer.from(await file.arrayBuffer());
  return sharp(input)
    .rotate()
    .resize({ width: BLUR_WIDTH, withoutEnlargement: true })
    .blur(10)
    .webp({ quality: BLUR_QUALITY })
    .toBuffer();
}

async function generateThumbBytes(file: File): Promise<Buffer | null> {
  const input = Buffer.from(await file.arrayBuffer());
  return sharp(input)
    .rotate()
    .resize({ width: THUMB_WIDTH, withoutEnlargement: true })
    .webp({ quality: THUMB_QUALITY })
    .toBuffer();
}

async function uploadBytesToBucket(
  adminClient: ReturnType<typeof createAdminClient>,
  bucket: string,
  path: string,
  bytes: Buffer,
  cacheControl: string
): Promise<boolean> {
  const up = await adminClient.storage.from(bucket).upload(path, bytes, {
    contentType: "image/webp",
    upsert: false,
    cacheControl,
  });
  if (!up.error) return true;
  const message = (up.error.message ?? "").toLowerCase();
  return message.includes("already") || message.includes("duplicate") || message.includes("exists");
}

export async function POST(req: Request) {
  const originResponse = ensureAllowedMutationOrigin(req);
  if (originResponse) return originResponse;

  const { user } = await getRequestAuthContext(req);

  if (!user) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }

  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json(
      { error: "서버 설정 오류입니다. 관리자에게 문의해주세요. (SUPABASE_SERVICE_ROLE_KEY)" },
      { status: 500 }
    );
  }

  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });

  const file = form.get("file");
  const kind = String(form.get("kind") ?? "raw");
  const assetIdRaw = String(form.get("asset_id") ?? "").trim();
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
  if (!["raw", "blur", "lite"].includes(kind)) {
    return NextResponse.json({ error: "kind 값이 올바르지 않습니다." }, { status: 400 });
  }

  const safeAssetId = assetIdRaw.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 80);
  const ext = kind === "blur" ? "webp" : file.type === "image/png" ? "png" : file.type === "webp" ? "webp" : "jpg";
  const folder = kind === "blur" ? "blur" : kind === "lite" ? "lite" : "raw";
  const baseName = safeAssetId || `${Date.now()}`;
  const path = `cards/${user.id}/${folder}/${baseName}-${index}.${ext}`;

  try {
    const adminClient = createAdminClient();
    const blurUploadOverride =
      kind === "blur"
        ? {
            contentType: "image/webp",
            bytes: await toBlurWebpBytes(file),
          }
        : undefined;
    const { error } = await uploadCardPhoto(adminClient, path, file, blurUploadOverride);

    if (error) {
      console.error("[POST /api/dating/cards/upload-card] failed", error);
      return NextResponse.json(
        { error: `카드 사진 업로드에 실패했습니다. ${error.message ?? "잠시 후 다시 시도해주세요."}` },
        { status: 500 }
      );
    }

    if (kind === "lite" || kind === "blur") {
      const litePublicRes = await uploadLitePublicPhoto(adminClient, path, file, blurUploadOverride);
      if (litePublicRes.error) {
        console.warn("[POST /api/dating/cards/upload-card] public mirror upload failed", {
          pathTail: path.split("/").slice(-2).join("/"),
          message: litePublicRes.error.message ?? null,
        });
      } else {
        await kvSetString(`litepublic:${path}`, "1", 365 * 24 * 60 * 60);
      }

      if (kind === "lite") {
        const thumbPath = toThumbPath(path);
        const thumbBytes = await generateThumbBytes(file);
        if (!thumbBytes) {
          console.warn("[POST /api/dating/cards/upload-card] thumb generation failed", {
            pathTail: thumbPath.split("/").slice(-2).join("/"),
          });
        } else {
          const privateOk = await uploadBytesToBucket(adminClient, CARD_BUCKET, thumbPath, thumbBytes, "3600");
          if (!privateOk) {
            console.warn("[POST /api/dating/cards/upload-card] thumb private upload failed", {
              pathTail: thumbPath.split("/").slice(-2).join("/"),
            });
          }
          const publicOk = await uploadBytesToBucket(adminClient, LITE_PUBLIC_BUCKET, thumbPath, thumbBytes, "31536000");
          if (!publicOk) {
            console.warn("[POST /api/dating/cards/upload-card] thumb public upload failed", {
              pathTail: thumbPath.split("/").slice(-2).join("/"),
            });
          } else {
            await kvSetString(`litepublic:${thumbPath}`, "1", 365 * 24 * 60 * 60);
          }
        }
      }
    }

    return NextResponse.json({ path }, { status: 201 });
  } catch (error) {
    console.error("[POST /api/dating/cards/upload-card] exception", error);
    const message = error instanceof Error ? error.message : "알 수 없는 오류";
    return NextResponse.json({ error: `카드 사진 업로드에 실패했습니다. ${message}` }, { status: 500 });
  }
}
