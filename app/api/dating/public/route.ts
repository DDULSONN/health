import { createClient, createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

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
    .select("id, sex, display_nickname, age, thumb_blur_path, total_3lift, percent_all, created_at")
    .eq("sex", "male")
    .eq("approved_for_public", true)
    .not("thumb_blur_path", "is", null)
    .order("created_at", { ascending: false })
    .limit(3);

  // 여자 TOP 3 (최신순)
  const { data: females } = await adminClient
    .from("dating_applications")
    .select("id, sex, display_nickname, age, thumb_blur_path, total_3lift, percent_all, created_at")
    .eq("sex", "female")
    .eq("approved_for_public", true)
    .not("thumb_blur_path", "is", null)
    .order("created_at", { ascending: false })
    .limit(3);

  // 블러 썸네일 signed URL 생성
  const withSignedUrls = async (items: typeof males) => {
    if (!items) return [];
    return Promise.all(
      items.map(async (item) => {
        let thumbUrl = "";
        if (item.thumb_blur_path) {
          const { data } = await adminClient.storage
            .from("dating-photos")
            .createSignedUrl(item.thumb_blur_path, 600);
          thumbUrl = data?.signedUrl ?? "";
        }
        return { ...item, thumb_url: thumbUrl };
      })
    );
  };

  const maleCards = await withSignedUrls(males);
  const femaleCards = await withSignedUrls(females);

  return NextResponse.json({ males: maleCards, females: femaleCards });
}
