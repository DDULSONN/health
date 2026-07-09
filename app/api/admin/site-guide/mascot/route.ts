import { NextResponse } from "next/server";
import { isAllowedAdminUser } from "@/lib/admin";
import { buildPublicLiteImageUrl } from "@/lib/images";
import { ensureAllowedMutationOrigin } from "@/lib/request-origin";
import {
  SITE_GUIDE_MASCOT_SETTING_KEY,
  normalizeSiteGuideMascotSetting,
  readSiteGuideMascotSetting,
} from "@/lib/site-guide-mascot";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import sharp from "sharp";

export const runtime = "nodejs";

const BUCKET = "community";
const UPLOAD_PREFIX = "site-guide-mascots";
const MAX_FILE_SIZE = 12 * 1024 * 1024;
const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const ALLOWED_EXTENSIONS = new Set(["jpg", "jpeg", "png", "webp"]);

async function checkAdmin() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !isAllowedAdminUser(user.id, user.email)) return null;
  return user;
}

export async function GET() {
  const user = await checkAdmin();
  if (!user) return NextResponse.json({ error: "관리자 권한이 없습니다." }, { status: 403 });

  return NextResponse.json(await readSiteGuideMascotSetting());
}

export async function PATCH(req: Request) {
  const originResponse = ensureAllowedMutationOrigin(req);
  if (originResponse) return originResponse;

  const user = await checkAdmin();
  if (!user) return NextResponse.json({ error: "관리자 권한이 없습니다." }, { status: 403 });

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "설정 값이 올바르지 않습니다." }, { status: 400 });
  }

  const setting = normalizeSiteGuideMascotSetting({
    selectedId: (body as { selectedId?: unknown }).selectedId,
    customOptions: (await readSiteGuideMascotSetting()).customOptions,
  });

  const adminClient = createAdminClient();
  const { error } = await adminClient.from("site_settings").upsert(
    {
      key: SITE_GUIDE_MASCOT_SETTING_KEY,
      value_json: { selectedId: setting.selectedId, customOptions: setting.customOptions },
      updated_at: new Date().toISOString(),
      updated_by: user.id,
    },
    { onConflict: "key" }
  );

  if (error) {
    console.error("[PATCH /api/admin/site-guide/mascot] failed", error);
    return NextResponse.json({ error: "짐냥이 설정 저장에 실패했습니다." }, { status: 500 });
  }

  return NextResponse.json({ ok: true, setting });
}

function getFileExtension(fileName: string) {
  const normalized = fileName.trim().toLowerCase();
  const idx = normalized.lastIndexOf(".");
  return idx >= 0 ? normalized.slice(idx + 1) : "";
}

export async function POST(req: Request) {
  const originResponse = ensureAllowedMutationOrigin(req);
  if (originResponse) return originResponse;

  const user = await checkAdmin();
  if (!user) return NextResponse.json({ error: "관리자 권한이 없습니다." }, { status: 403 });

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "업로드할 이미지가 필요합니다." }, { status: 400 });
  }

  const fileType = file.type.toLowerCase();
  const fileExtension = getFileExtension(file.name);
  if (!ALLOWED_TYPES.has(fileType) && !ALLOWED_EXTENSIONS.has(fileExtension)) {
    return NextResponse.json({ error: "JPG, PNG, WebP 이미지만 업로드할 수 있습니다." }, { status: 400 });
  }

  if (file.size > MAX_FILE_SIZE) {
    return NextResponse.json({ error: "12MB 이하 이미지만 업로드할 수 있습니다." }, { status: 400 });
  }

  let webpBytes: Buffer;
  try {
    webpBytes = await sharp(Buffer.from(await file.arrayBuffer()))
      .rotate()
      .resize({ width: 640, withoutEnlargement: true, fit: "inside" })
      .webp({ quality: 70, effort: 5 })
      .toBuffer();
  } catch (error) {
    console.error("[POST /api/admin/site-guide/mascot] image processing failed", error);
    return NextResponse.json({ error: "이미지를 처리하지 못했습니다. 다른 사진으로 다시 시도해주세요." }, { status: 400 });
  }

  const adminClient = createAdminClient();
  const id = `custom-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
  const path = `${UPLOAD_PREFIX}/${id}.webp`;
  const uploadRes = await adminClient.storage.from(BUCKET).upload(path, webpBytes, {
    contentType: "image/webp",
    upsert: false,
    cacheControl: "86400",
  });

  if (uploadRes.error) {
    console.error("[POST /api/admin/site-guide/mascot] upload failed", uploadRes.error);
    return NextResponse.json({ error: "짐냥이 이미지 업로드에 실패했습니다." }, { status: 500 });
  }

  const current = await readSiteGuideMascotSetting();
  const option = {
    id,
    label: "업로드 짐냥이",
    src: buildPublicLiteImageUrl(BUCKET, path),
  };
  const setting = normalizeSiteGuideMascotSetting({
    selectedId: id,
    customOptions: [...current.customOptions, option],
  });

  const { error } = await adminClient.from("site_settings").upsert(
    {
      key: SITE_GUIDE_MASCOT_SETTING_KEY,
      value_json: { selectedId: setting.selectedId, customOptions: setting.customOptions },
      updated_at: new Date().toISOString(),
      updated_by: user.id,
    },
    { onConflict: "key" }
  );

  if (error) {
    console.error("[POST /api/admin/site-guide/mascot] setting save failed", error);
    return NextResponse.json({ error: "업로드한 짐냥이 저장에 실패했습니다." }, { status: 500 });
  }

  return NextResponse.json({ ok: true, setting }, { status: 201 });
}
