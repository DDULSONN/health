import { createAdminClient } from "@/lib/supabase/server";
import { getRequestAuthContext } from "@/lib/supabase/request";
import { NextResponse } from "next/server";
import sharp from "sharp";

export const runtime = "nodejs";

const BUCKET = "dating-1on1-photos";
const MAX_FILE_SIZE = 7 * 1024 * 1024;
const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

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
  const { user } = await getRequestAuthContext(req);

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "File is required." }, { status: 400 });
  }

  if (!ALLOWED_TYPES.has(file.type)) {
    return NextResponse.json({ error: "Only JPG/PNG/WebP is allowed." }, { status: 400 });
  }

  if (file.size > MAX_FILE_SIZE) {
    return NextResponse.json({ error: "File size must be 7MB or less." }, { status: 400 });
  }

  const webpBytes = await sharp(Buffer.from(await file.arrayBuffer()))
    .rotate()
    .resize({ width: 1200, withoutEnlargement: true, fit: "inside" })
    .webp({ quality: 72 })
    .toBuffer();

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
    return NextResponse.json({ error: "Failed to upload image." }, { status: 500 });
  }

  return NextResponse.json({ path }, { status: 201 });
}
