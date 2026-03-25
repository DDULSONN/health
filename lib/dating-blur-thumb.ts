import sharp from "sharp";
import { kvSetString } from "@/lib/edge-kv";
import { extractStorageObjectPathFromBuckets } from "@/lib/images";
import { createAdminClient } from "@/lib/supabase/server";

const CARD_BUCKET = "dating-card-photos";
const LITE_PUBLIC_BUCKET = "dating-card-lite";
const BLUR_WIDTH = 560;
const BLUR_QUALITY = 68;

function normalizeDatingPhotoPath(raw: unknown): string {
  if (typeof raw !== "string") return "";
  const value = raw.trim();
  if (!value) return "";
  return extractStorageObjectPathFromBuckets(value, [CARD_BUCKET, "dating-photos"]) ?? value;
}

function toBlurPath(rawPath: string): string {
  return rawPath.replace("/raw/", "/blur/").replace(/\.[^.\/]+$/, ".webp");
}

async function ensureLitePublicBucket(adminClient: ReturnType<typeof createAdminClient>) {
  const { error } = await adminClient.storage.createBucket(LITE_PUBLIC_BUCKET, {
    public: true,
    fileSizeLimit: "5242880",
    allowedMimeTypes: ["image/jpeg", "image/png", "image/webp"],
  });

  if (!error) return;

  const message = (error.message ?? "").toLowerCase();
  const alreadyExists = message.includes("already") || message.includes("duplicate");
  if (!alreadyExists) {
    throw error;
  }
}

async function uploadWithEnsureBucket(
  adminClient: ReturnType<typeof createAdminClient>,
  bucket: string,
  path: string,
  bytes: Buffer,
  cacheControl: string
) {
  const res = await adminClient.storage.from(bucket).upload(path, bytes, {
    contentType: "image/webp",
    upsert: true,
    cacheControl,
  });

  if (!res.error) return true;

  const message = (res.error.message ?? "").toLowerCase();
  const bucketMissing = message.includes("bucket") && message.includes("not");
  if (!bucketMissing) {
    console.warn("[dating-blur-thumb] upload failed", { bucket, pathTail: path.split("/").slice(-2).join("/"), message: res.error.message });
    return false;
  }

  if (bucket === LITE_PUBLIC_BUCKET) {
    await ensureLitePublicBucket(adminClient);
  }

  const retry = await adminClient.storage.from(bucket).upload(path, bytes, {
    contentType: "image/webp",
    upsert: true,
    cacheControl,
  });

  if (retry.error) {
    console.warn("[dating-blur-thumb] retry upload failed", { bucket, pathTail: path.split("/").slice(-2).join("/"), message: retry.error.message });
    return false;
  }

  return true;
}

export async function ensureBlurThumbFromRaw(
  adminClient: ReturnType<typeof createAdminClient>,
  rawPathInput: string
): Promise<string | null> {
  const rawPath = normalizeDatingPhotoPath(rawPathInput);
  if (!rawPath || !rawPath.includes("/raw/")) return null;

  const blurPath = toBlurPath(rawPath);
  const downloadRes = await adminClient.storage.from(CARD_BUCKET).download(rawPath);
  if (downloadRes.error || !downloadRes.data) {
    console.warn("[dating-blur-thumb] raw download failed", {
      pathTail: rawPath.split("/").slice(-2).join("/"),
      message: downloadRes.error?.message ?? null,
    });
    return null;
  }

  const input = Buffer.from(await downloadRes.data.arrayBuffer());
  const blurBytes = await sharp(input)
    .rotate()
    .resize({ width: BLUR_WIDTH, withoutEnlargement: true })
    .blur(10)
    .webp({ quality: BLUR_QUALITY })
    .toBuffer();

  const privateOk = await uploadWithEnsureBucket(adminClient, CARD_BUCKET, blurPath, blurBytes, "3600");
  const publicOk = await uploadWithEnsureBucket(adminClient, LITE_PUBLIC_BUCKET, blurPath, blurBytes, "31536000");

  if (publicOk) {
    await kvSetString(`litepublic:${blurPath}`, "1", 365 * 24 * 60 * 60);
  }

  return privateOk || publicOk ? blurPath : null;
}
