import { createClient, createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

const MAX_FILE_SIZE = 5 * 1024 * 1024;
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"];
const CARD_BUCKET = "dating-card-photos";

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

async function uploadCardPhoto(
  adminClient: ReturnType<typeof createAdminClient>,
  path: string,
  file: File
) {
  const firstTry = await adminClient.storage.from(CARD_BUCKET).upload(path, file, {
    contentType: file.type,
    upsert: false,
    cacheControl: "3600",
  });

  if (!firstTry.error) return { error: null as null | { message?: string } };

  const message = (firstTry.error.message ?? "").toLowerCase();
  const bucketMissing = message.includes("bucket") && message.includes("not");
  if (!bucketMissing) return { error: firstTry.error };

  await ensureCardBucket(adminClient);

  const secondTry = await adminClient.storage.from(CARD_BUCKET).upload(path, file, {
    contentType: file.type,
    upsert: false,
    cacheControl: "3600",
  });

  return { error: secondTry.error };
}

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "濡쒓렇?몄씠 ?꾩슂?⑸땲??" }, { status: 401 });
  }

  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json(
      { error: "?쒕쾭 ?ㅼ젙 ?ㅻ쪟?낅땲?? 愿由ъ옄?먭쾶 臾몄쓽?댁＜?몄슂. (SUPABASE_SERVICE_ROLE_KEY)" },
      { status: 500 }
    );
  }

  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "?섎せ???붿껌?낅땲??" }, { status: 400 });

  const file = form.get("file");
  const kind = String(form.get("kind") ?? "raw");
  const assetIdRaw = String(form.get("asset_id") ?? "").trim();
  const index = Number(String(form.get("index") ?? "0"));

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "?뚯씪???꾩슂?⑸땲??" }, { status: 400 });
  }

  if (!ALLOWED_TYPES.includes(file.type)) {
    return NextResponse.json({ error: "JPG/PNG/WebP ?뚯씪留??낅줈?쒗븷 ???덉뒿?덈떎." }, { status: 400 });
  }

  if (file.size > MAX_FILE_SIZE) {
    return NextResponse.json({ error: "?뚯씪? 5MB ?댄븯留?媛?ν빀?덈떎." }, { status: 400 });
  }

  if (index < 0 || index > 9) {
    return NextResponse.json({ error: "index 값이 올바르지 않습니다." }, { status: 400 });
  }
  if (!["raw", "blur", "lite"].includes(kind)) {
    return NextResponse.json({ error: "kind 값이 올바르지 않습니다." }, { status: 400 });
  }

  const safeAssetId = assetIdRaw.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 80);
  const ext = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
  const folder = kind === "blur" ? "blur" : kind === "lite" ? "lite" : "raw";
  const baseName = safeAssetId || `${Date.now()}`;
  const path = `cards/${user.id}/${folder}/${baseName}-${index}.${ext}`;

  try {
    const adminClient = createAdminClient();
    const { error } = await uploadCardPhoto(adminClient, path, file);

    if (error) {
      console.error("[POST /api/dating/cards/upload-card] failed", error);
      return NextResponse.json(
        { error: `移대뱶 ?ъ쭊 ?낅줈?쒖뿉 ?ㅽ뙣?덉뒿?덈떎. ${error.message ?? "?좎떆 ???ㅼ떆 ?쒕룄?댁＜?몄슂."}` },
        { status: 500 }
      );
    }

    return NextResponse.json({ path }, { status: 201 });
  } catch (error) {
    console.error("[POST /api/dating/cards/upload-card] exception", error);
    const message = error instanceof Error ? error.message : "?????녿뒗 ?ㅻ쪟";
    return NextResponse.json({ error: `移대뱶 ?ъ쭊 ?낅줈?쒖뿉 ?ㅽ뙣?덉뒿?덈떎. ${message}` }, { status: 500 });
  }
}

