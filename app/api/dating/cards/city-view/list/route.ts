import { CITY_VIEW_CARD_LIMIT, getActiveCityViewGrant, getCityViewTargetSex } from "@/lib/dating-city-view";
import { fetchCityViewCandidateRows, sortCityViewCandidates } from "@/lib/dating-city-view-candidates";
import { extractProvinceFromRegion } from "@/lib/region-city";
import { buildSignedImageUrl, extractStorageObjectPathFromBuckets } from "@/lib/images";
import { getRequestAuthContext } from "@/lib/supabase/request";
import { createAdminClient } from "@/lib/supabase/server";
import { getDatingBlockedUserIds } from "@/lib/dating-blocks";
import { filterDatingCardsByContactBlocks } from "@/lib/dating-contact-blocks";
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
  const { user } = await getRequestAuthContext(req);

  if (!user) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const provinceRaw = (searchParams.get("province") ?? searchParams.get("city") ?? "").trim();
  const province = extractProvinceFromRegion(provinceRaw) ?? provinceRaw;
  if (!province) {
    return NextResponse.json({ error: "province 값이 필요합니다." }, { status: 400 });
  }

  const admin = createAdminClient();
  const [blockedUserIds, activeGrant, targetSex] = await Promise.all([
    getDatingBlockedUserIds(admin, user.id),
    getActiveCityViewGrant(admin, user.id, province),
    getCityViewTargetSex(admin, user.id),
  ]);
  if (!activeGrant) {
    return NextResponse.json({ error: "해당 도/광역시는 구매 또는 무료 열람 후 이용 가능합니다." }, { status: 403 });
  }

  const selectColumns =
    "id, owner_user_id, sex, display_nickname, age, region, height_cm, job, training_years, ideal_type, strengths_text, photo_visibility, total_3lift, percent_all, is_3lift_verified, photo_paths, blur_paths, blur_thumb_path, instagram_id, expires_at, created_at, status";
  let rows;
  try {
    rows = await fetchCityViewCandidateRows(admin);
  } catch {
    return NextResponse.json({ error: "목록을 불러오지 못했습니다." }, { status: 500 });
  }

  const now = Date.now();
  let eligibleRows = rows
    .filter((row) => row.status === "pending" || (row.status === "public" && row.expires_at && new Date(row.expires_at).getTime() > now))
    .filter((row) => !targetSex || row.sex === targetSex)
    .filter((row) => Boolean(extractProvinceFromRegion(row.region)))
    .filter((row) => String(row.owner_user_id ?? "") !== user.id)
    .filter((row) => !blockedUserIds.has(String(row.owner_user_id ?? "")));
  eligibleRows = await filterDatingCardsByContactBlocks(admin, user.id, eligibleRows);
  eligibleRows = sortCityViewCandidates(eligibleRows, province);

  const preferredRows = eligibleRows.slice(0, CITY_VIEW_CARD_LIMIT);
  const selectedCardIds = preferredRows.map((row) => row.id);
  const previousCardIds = activeGrant.snapshotCardIds.slice(0, CITY_VIEW_CARD_LIMIT);
  const snapshotChanged =
    selectedCardIds.length !== previousCardIds.length ||
    selectedCardIds.some((id, index) => id !== previousCardIds[index]);
  if (snapshotChanged && selectedCardIds.length > 0) {
    await admin
      .from("dating_city_view_requests")
      .update({ snapshot_card_ids: selectedCardIds })
      .eq("id", activeGrant.requestId)
      .eq("status", "approved");
  }

  const selectedCardsRes =
    selectedCardIds.length > 0
      ? await admin.from("dating_cards").select(selectColumns).in("id", selectedCardIds)
      : { data: [], error: null };
  if (selectedCardsRes.error) {
    return NextResponse.json({ error: "카드 정보를 불러오지 못했습니다." }, { status: 500 });
  }

  const selectedById = new Map(
    (selectedCardsRes.data ?? [])
      .map((row) => [String(row.id ?? ""), row] as const)
      .filter(([id]) => id.length > 0)
  );
  const selected = selectedCardIds
    .map((id) => selectedById.get(id))
    .filter((row): row is NonNullable<typeof row> => Boolean(row));
  const ownerIds = [...new Set(selected.map((row) => String(row.owner_user_id ?? "")).filter((id) => id.length > 0))];
  const phoneVerifiedByOwner = new Map<string, boolean>();
  if (ownerIds.length > 0) {
    const profileRes = await admin.from("profiles").select("user_id,phone_verified").in("user_id", ownerIds);
    if (!profileRes.error && Array.isArray(profileRes.data)) {
      for (const profile of profileRes.data as Array<{ user_id: string; phone_verified: boolean | null }>) {
        phoneVerifiedByOwner.set(String(profile.user_id), profile.phone_verified === true);
      }
    }
  }

  const items = selected.map((row) => {
    const photoVisibility = row.photo_visibility === "public" ? "public" : "blur";
    return {
      id: row.id,
      sex: row.sex,
      display_nickname: row.display_nickname,
      is_phone_verified: phoneVerifiedByOwner.get(String(row.owner_user_id ?? "")) === true,
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

  const includedProvinces = [...new Set(items.map((item) => extractProvinceFromRegion(item.region) ?? "").filter(Boolean))];

  return NextResponse.json({ items, province, includedProvinces, limit: CITY_VIEW_CARD_LIMIT, expiresAt: activeGrant.accessExpiresAt, targetSex });
}


