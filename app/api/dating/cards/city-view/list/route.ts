import { getActiveApprovedCities } from "@/lib/dating-city-view";
import { extractCityFromRegion } from "@/lib/region-city";
import { buildSignedImageUrl, extractStorageObjectPathFromBuckets } from "@/lib/images";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

function normalizePath(value: unknown): string {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  if (!trimmed) return "";
  return extractStorageObjectPathFromBuckets(trimmed, ["dating-card-photos", "dating-photos"]) ?? trimmed;
}

function toImageUrls(photoVisibility: "blur" | "public", photoPaths: unknown, blurPaths: unknown, blurThumbPath: unknown): string[] {
  if (photoVisibility === "public" && Array.isArray(photoPaths)) {
    const urls = photoPaths
      .map((v) => normalizePath(v))
      .filter(Boolean)
      .slice(0, 2)
      .map((path) => buildSignedImageUrl("dating-card-photos", path))
      .filter((v): v is string => Boolean(v));
    if (urls.length > 0) return urls;
  }

  if (Array.isArray(blurPaths)) {
    const urls = blurPaths
      .map((v) => normalizePath(v))
      .filter(Boolean)
      .slice(0, 2)
      .map((path) => buildSignedImageUrl("dating-card-photos", path))
      .filter((v): v is string => Boolean(v));
    if (urls.length > 0) return urls;
  }

  const blurThumb = normalizePath(blurThumbPath);
  if (blurThumb) {
    const signed = buildSignedImageUrl("dating-card-photos", blurThumb);
    if (signed) {
      return photoVisibility === "blur" ? [signed, signed] : [signed];
    }
  }

  return [];
}

export async function GET(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const cityRaw = (searchParams.get("city") ?? "").trim();
  const city = extractCityFromRegion(cityRaw) ?? cityRaw;
  if (!city) {
    return NextResponse.json({ error: "city 값이 필요합니다." }, { status: 400 });
  }

  const admin = createAdminClient();
  const activeCities = await getActiveApprovedCities(admin, user.id);
  if (!activeCities.includes(city)) {
    return NextResponse.json({ error: "해당 도시는 승인 후 이용 가능합니다." }, { status: 403 });
  }

  const pendingCardsRes = await admin
    .from("dating_cards")
    .select(
      "id, sex, display_nickname, age, region, height_cm, job, training_years, ideal_type, strengths_text, photo_visibility, total_3lift, percent_all, is_3lift_verified, photo_paths, blur_paths, blur_thumb_path, expires_at, created_at, status"
    )
    .eq("status", "pending")
    .order("created_at", { ascending: false })
    .limit(5000);

  if (pendingCardsRes.error) {
    return NextResponse.json({ error: "목록을 불러오지 못했습니다." }, { status: 500 });
  }

  const rows = Array.isArray(pendingCardsRes.data) ? pendingCardsRes.data : [];
  const selected = rows.filter((row) => extractCityFromRegion(row.region) === city).slice(0, 300);

  const items = selected.map((row) => {
    const photoVisibility = row.photo_visibility === "public" ? "public" : "blur";
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
      image_urls: toImageUrls(photoVisibility, row.photo_paths, row.blur_paths, row.blur_thumb_path),
      expires_at: row.expires_at ?? null,
      created_at: row.created_at,
    };
  });

  return NextResponse.json({ items, city });
}
