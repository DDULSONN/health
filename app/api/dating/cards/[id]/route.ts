import { createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

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

async function createBlurPhotoSignedUrl(adminClient: ReturnType<typeof createAdminClient>, path: string) {
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
  blurPaths: unknown,
  blurThumbPath: unknown,
  photoVisibility: "blur" | "public"
) {
  if (photoVisibility === "public") {
    const rawPaths = Array.isArray(photoPaths)
      ? photoPaths.filter((item): item is string => typeof item === "string" && item.length > 0).slice(0, 2)
      : [];
    const rawUrls = (
      await Promise.all(rawPaths.map((path) => createOriginalPhotoSignedUrl(adminClient, path)))
    ).filter((url): url is string => Boolean(url));
    if (rawUrls.length > 0) return rawUrls;
  }

  const blurPathList = Array.isArray(blurPaths)
    ? blurPaths.filter((item): item is string => typeof item === "string" && item.length > 0).slice(0, 2)
    : [];
  const blurUrls = (
    await Promise.all(blurPathList.map((path) => createBlurPhotoSignedUrl(adminClient, path)))
  ).filter((url): url is string => Boolean(url));
  if (blurUrls.length > 0) return blurUrls;

  if (typeof blurThumbPath === "string" && blurThumbPath) {
    const fallback = await createBlurThumbSignedUrl(adminClient, blurThumbPath);
    if (fallback) {
      if (photoVisibility === "blur") return [fallback, fallback];
      return [fallback];
    }
  }

  return [];
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const adminClient = createAdminClient();

  let { data, error } = await adminClient
    .from("dating_cards")
    .select(
      "id, sex, display_nickname, age, region, height_cm, job, training_years, ideal_type, strengths_text, photo_visibility, total_3lift, percent_all, is_3lift_verified, photo_paths, blur_paths, blur_thumb_path, expires_at, created_at, status"
    )
    .eq("id", id)
    .single();

  if (error && isMissingColumnError(error)) {
    const legacyRes = await adminClient
      .from("dating_cards")
      .select(
        "id, sex, display_nickname, age, region, height_cm, job, training_years, ideal_type, total_3lift, percent_all, is_3lift_verified, photo_paths, blur_thumb_path, expires_at, created_at, status"
      )
      .eq("id", id)
      .single();

    data = legacyRes.data
      ? {
          ...legacyRes.data,
          strengths_text: null,
          photo_visibility: "blur",
          blur_paths: [],
        }
      : null;
    error = legacyRes.error;
  }

  if (error || !data) {
    return NextResponse.json({ error: "카드를 찾을 수 없습니다." }, { status: 404 });
  }

  if (data.status !== "public" || !data.expires_at || new Date(data.expires_at).getTime() <= Date.now()) {
    return NextResponse.json({ error: "공개 중인 카드가 아닙니다." }, { status: 403 });
  }

  const photoVisibility = data.photo_visibility === "public" ? "public" : "blur";
  const imageUrls = await createSignedImageUrls(
    adminClient,
    data.photo_paths,
    data.blur_paths,
    data.blur_thumb_path,
    photoVisibility
  );

  return NextResponse.json({
    card: {
      id: data.id,
      sex: data.sex,
      display_nickname: data.display_nickname,
      age: data.age,
      region: data.region,
      height_cm: data.height_cm,
      job: data.job,
      training_years: data.training_years,
      ideal_type: data.ideal_type,
      strengths_text: data.strengths_text,
      photo_visibility: photoVisibility,
      total_3lift: data.total_3lift,
      percent_all: data.percent_all,
      is_3lift_verified: data.is_3lift_verified,
      image_urls: imageUrls,
      expires_at: data.expires_at,
      created_at: data.created_at,
    },
    can_apply: true,
  });
}
