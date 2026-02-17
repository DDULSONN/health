import { createClient, createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

function normalizeSex(value: string): "male" | "female" {
  const v = value.trim().toLowerCase();
  if (v === "male" || v === "남자" || v === "남성" || v === "m") return "male";
  return "female";
}

/** GET /api/dating/public — 공개된 소개팅 카드 목록 (남/여 각 3개) */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }

  const adminClient = createAdminClient();

  // 남자 TOP 3 (최신순)
  const { data: males } = await adminClient
    .from("dating_applications")
    .select("id, sex, display_nickname, age, thumb_blur_path, photo_urls, total_3lift, percent_all, training_years, ideal_type, created_at")
    .in("sex", ["male", "남자", "남성", "m"])
    .eq("approved_for_public", true)
    .order("created_at", { ascending: false })
    .limit(3);

  // 여자 TOP 3 (최신순)
  const { data: females } = await adminClient
    .from("dating_applications")
    .select("id, sex, display_nickname, age, thumb_blur_path, photo_urls, total_3lift, percent_all, training_years, ideal_type, created_at")
    .in("sex", ["female", "여자", "여성", "f"])
    .eq("approved_for_public", true)
    .order("created_at", { ascending: false })
    .limit(3);

  // 블러 썸네일 signed URL 생성
  const withSignedUrls = async (items: typeof males) => {
    if (!items) return [];
    return Promise.all(
      items.map(async (item) => {
        let thumbUrl = "";
        let isBlurFallback = false;
        if (item.thumb_blur_path && item.thumb_blur_path.trim().length > 0) {
          const { data } = await adminClient.storage
            .from("dating-photos")
            .createSignedUrl(item.thumb_blur_path, 600);
          thumbUrl = data?.signedUrl ?? "";
        }

        // Fallback: thumb_blur_path가 없는 기존 데이터는 1번 사진을 CSS blur로 처리해 노출
        if (!thumbUrl) {
          const photoPaths = Array.isArray(item.photo_urls) ? item.photo_urls : [];
          const firstPhotoPath = typeof photoPaths[0] === "string" ? photoPaths[0] : "";
          if (firstPhotoPath) {
            const { data } = await adminClient.storage
              .from("dating-photos")
              .createSignedUrl(firstPhotoPath, 600);
            thumbUrl = data?.signedUrl ?? "";
            isBlurFallback = !!thumbUrl;
          }
        }

        return { ...item, sex: normalizeSex(item.sex), thumb_url: thumbUrl, is_blur_fallback: isBlurFallback };
      })
    );
  };

  const maleCards = await withSignedUrls(males);
  const femaleCards = await withSignedUrls(females);

  return NextResponse.json({ males: maleCards, females: femaleCards });
}
