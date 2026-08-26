import { NextResponse } from "next/server";
import sharp from "sharp";
import { requireAdminRoute } from "@/lib/admin-route";
import {
  DEFAULT_HEADER_AD_SETTING,
  HEADER_AD_SETTING_KEY,
  isHeaderAdVisible,
  normalizeHeaderAdSetting,
} from "@/lib/header-ad";
import { buildPublicLiteImageUrl } from "@/lib/images";
import { ensureAllowedMutationOrigin } from "@/lib/request-origin";

export const runtime = "nodejs";

const BUCKET = "community";
const UPLOAD_PREFIX = "header-ads";
const MAX_FILE_SIZE = 12 * 1024 * 1024;
const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

async function readSetting(admin: Awaited<ReturnType<typeof requireAdminRoute>> & { ok: true }) {
  const { data, error } = await admin.admin
    .from("site_settings")
    .select("value_json")
    .eq("key", HEADER_AD_SETTING_KEY)
    .maybeSingle();

  if (error) throw error;
  return normalizeHeaderAdSetting(data?.value_json ?? DEFAULT_HEADER_AD_SETTING);
}

async function saveSetting(
  admin: Awaited<ReturnType<typeof requireAdminRoute>> & { ok: true },
  setting: ReturnType<typeof normalizeHeaderAdSetting>,
) {
  const { error } = await admin.admin.from("site_settings").upsert(
    {
      key: HEADER_AD_SETTING_KEY,
      value_json: setting,
      updated_at: new Date().toISOString(),
      updated_by: admin.user.id,
    },
    { onConflict: "key" },
  );
  if (error) throw error;
}

function responseSetting(setting: ReturnType<typeof normalizeHeaderAdSetting>) {
  return { ...setting, visible: isHeaderAdVisible(setting) };
}

export async function GET() {
  const auth = await requireAdminRoute();
  if (!auth.ok) return auth.response;

  try {
    return NextResponse.json(responseSetting(await readSetting(auth)));
  } catch (error) {
    console.error("[GET /api/admin/site/header-ad] failed", error);
    return NextResponse.json({ error: "헤더 배너 설정을 불러오지 못했습니다." }, { status: 500 });
  }
}

export async function PATCH(req: Request) {
  const originResponse = ensureAllowedMutationOrigin(req);
  if (originResponse) return originResponse;

  const auth = await requireAdminRoute();
  if (!auth.ok) return auth.response;

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "설정 값이 올바르지 않습니다." }, { status: 400 });
  }

  const raw = body as Record<string, unknown>;
  for (const field of ["startsAt", "expiresAt"] as const) {
    if (typeof raw[field] === "string" && raw[field] && Number.isNaN(new Date(raw[field]).getTime())) {
      return NextResponse.json({ error: "노출 기간의 날짜 형식이 올바르지 않습니다." }, { status: 400 });
    }
  }

  const setting = normalizeHeaderAdSetting(raw);
  if (setting.enabled && (!setting.imageUrl || !setting.linkUrl)) {
    return NextResponse.json({ error: "이미지와 이동 링크를 입력해야 광고를 노출할 수 있습니다." }, { status: 400 });
  }
  if (
    setting.startsAt &&
    setting.expiresAt &&
    new Date(setting.expiresAt).getTime() <= new Date(setting.startsAt).getTime()
  ) {
    return NextResponse.json({ error: "종료 시각은 시작 시각보다 뒤여야 합니다." }, { status: 400 });
  }

  try {
    await saveSetting(auth, setting);
    return NextResponse.json({ ok: true, setting: responseSetting(setting) });
  } catch (error) {
    console.error("[PATCH /api/admin/site/header-ad] failed", error);
    return NextResponse.json({ error: "헤더 배너 설정 저장에 실패했습니다." }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const originResponse = ensureAllowedMutationOrigin(req);
  if (originResponse) return originResponse;

  const auth = await requireAdminRoute();
  if (!auth.ok) return auth.response;

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "업로드할 이미지가 필요합니다." }, { status: 400 });
  }
  if (!ALLOWED_TYPES.has(file.type.toLowerCase())) {
    return NextResponse.json({ error: "JPG, PNG, WebP 이미지만 업로드할 수 있습니다." }, { status: 400 });
  }
  if (file.size > MAX_FILE_SIZE) {
    return NextResponse.json({ error: "12MB 이하 이미지만 업로드할 수 있습니다." }, { status: 400 });
  }

  let imageBytes: Buffer;
  try {
    imageBytes = await sharp(Buffer.from(await file.arrayBuffer()))
      .rotate()
      .resize(640, 160, { fit: "cover", position: "centre" })
      .webp({ quality: 72, effort: 5 })
      .toBuffer();
  } catch (error) {
    console.error("[POST /api/admin/site/header-ad] image processing failed", error);
    return NextResponse.json({ error: "이미지를 처리하지 못했습니다. 다른 이미지로 다시 시도해 주세요." }, { status: 400 });
  }

  const path = `${UPLOAD_PREFIX}/${Date.now()}-${crypto.randomUUID().slice(0, 8)}.webp`;
  const upload = await auth.admin.storage.from(BUCKET).upload(path, imageBytes, {
    contentType: "image/webp",
    cacheControl: "31536000",
    upsert: false,
  });
  if (upload.error) {
    console.error("[POST /api/admin/site/header-ad] upload failed", upload.error);
    return NextResponse.json({ error: "배너 이미지 업로드에 실패했습니다." }, { status: 500 });
  }

  try {
    const current = await readSetting(auth);
    const setting = normalizeHeaderAdSetting({
      ...current,
      imageUrl: buildPublicLiteImageUrl(BUCKET, path),
    });
    await saveSetting(auth, setting);
    return NextResponse.json({ ok: true, setting: responseSetting(setting) }, { status: 201 });
  } catch (error) {
    console.error("[POST /api/admin/site/header-ad] setting save failed", error);
    return NextResponse.json({ error: "업로드한 배너 설정 저장에 실패했습니다." }, { status: 500 });
  }
}
