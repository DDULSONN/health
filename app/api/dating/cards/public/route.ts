import { createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

function parseIntSafe(value: string | null, fallback: number) {
  if (!value) return fallback;
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(0, Math.floor(num));
}

function isMissingColumnError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = String((error as { code?: unknown }).code ?? "");
  const message = String((error as { message?: unknown }).message ?? "").toLowerCase();
  return code === "42703" || code === "PGRST204" || message.includes("could not find") || message.includes("column");
}

async function createBlurThumbSignedUrl(adminClient: ReturnType<typeof createAdminClient>, path: string) {
  const primary = await adminClient.storage.from("dating-card-photos").createSignedUrl(path, 3600);
  if (!primary.error && primary.data?.signedUrl) {
    return primary.data.signedUrl;
  }

  const legacy = await adminClient.storage.from("dating-photos").createSignedUrl(path, 3600);
  if (!legacy.error && legacy.data?.signedUrl) {
    return legacy.data.signedUrl;
  }

  return "";
}

async function createOriginalPhotoSignedUrl(adminClient: ReturnType<typeof createAdminClient>, path: string) {
  const primary = await adminClient.storage.from("dating-card-photos").createSignedUrl(path, 3600);
  if (!primary.error && primary.data?.signedUrl) {
    return primary.data.signedUrl;
  }

  const legacy = await adminClient.storage.from("dating-photos").createSignedUrl(path, 3600);
  if (!legacy.error && legacy.data?.signedUrl) {
    return legacy.data.signedUrl;
  }

  return "";
}

async function createSignedImageUrls(
  adminClient: ReturnType<typeof createAdminClient>,
  photoPaths: unknown,
  blurThumbPath: unknown
) {
  const rawPaths = Array.isArray(photoPaths)
    ? photoPaths.filter((item): item is string => typeof item === "string" && item.length > 0).slice(0, 2)
    : [];

  const urls = (
    await Promise.all(rawPaths.map((path) => createOriginalPhotoSignedUrl(adminClient, path)))
  ).filter((url): url is string => Boolean(url));

  if (urls.length > 0) return urls;

  if (typeof blurThumbPath === "string" && blurThumbPath) {
    const fallback = await createBlurThumbSignedUrl(adminClient, blurThumbPath);
    if (fallback) return [fallback];
  }

  return [];
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const limit = Math.min(parseIntSafe(searchParams.get("limit"), 20), 50);
  const offset = parseIntSafe(searchParams.get("offset"), 0);
  const sex = searchParams.get("sex");

  const adminClient = createAdminClient();
  let query = adminClient
    .from("dating_cards")
    .select(
      "id, owner_user_id, sex, display_nickname, age, region, height_cm, job, training_years, ideal_type, strengths_text, photo_visibility, total_3lift, percent_all, is_3lift_verified, photo_paths, blur_thumb_path, expires_at, created_at",
      { count: "exact" }
    )
    .eq("status", "public")
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false });

  if (sex === "male" || sex === "female") {
    query = query.eq("sex", sex);
  }

  let { data, error, count } = await query.range(offset, offset + limit - 1);
  if (error && isMissingColumnError(error)) {
    let legacyQuery = adminClient
      .from("dating_cards")
      .select(
        "id, owner_user_id, sex, display_nickname, age, region, height_cm, job, training_years, ideal_type, total_3lift, percent_all, is_3lift_verified, photo_paths, blur_thumb_path, expires_at, created_at",
        { count: "exact" }
      )
      .eq("status", "public")
      .gt("expires_at", new Date().toISOString())
      .order("created_at", { ascending: false });
    if (sex === "male" || sex === "female") {
      legacyQuery = legacyQuery.eq("sex", sex);
    }
    const legacyRes = await legacyQuery.range(offset, offset + limit - 1);
    data = (legacyRes.data ?? []).map((row) => ({
      ...row,
      strengths_text: null,
      photo_visibility: "blur",
    }));
    error = legacyRes.error;
    count = legacyRes.count;
  }
  if (error) {
    console.error("[GET /api/dating/cards/public] failed", error);
    return NextResponse.json({ error: "카드 목록을 불러오지 못했습니다." }, { status: 500 });
  }

  const items = await Promise.all(
    (data ?? []).map(async (row) => {
      const photoVisibility = row.photo_visibility === "public" ? "public" : "blur";
      const imageUrls = await createSignedImageUrls(adminClient, row.photo_paths, row.blur_thumb_path);
      return {
        id: row.id,
        sex: row.sex,
        display_nickname: row.display_nickname,
        age: row.age,
        region: row.region,
        height_cm: row.height_cm,
        job: row.job,
        training_years: row.training_years,
        ideal_type: row.ideal_type,
        strengths_text: row.strengths_text,
        photo_visibility: photoVisibility,
        total_3lift: row.total_3lift,
        percent_all: row.percent_all,
        is_3lift_verified: row.is_3lift_verified,
        image_urls: imageUrls,
        expires_at: row.expires_at,
        created_at: row.created_at,
      };
    })
  );

  const nextOffset = offset + items.length;
  const hasMore = (count ?? 0) > nextOffset;
  return NextResponse.json({ items, nextOffset, hasMore, total: count ?? 0 });
}
