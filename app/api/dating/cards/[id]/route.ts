import { createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

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

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const adminClient = createAdminClient();
  const { data, error } = await adminClient
    .from("dating_cards")
    .select(
      "id, sex, display_nickname, age, region, height_cm, job, training_years, ideal_type, total_3lift, percent_all, is_3lift_verified, blur_thumb_path, expires_at, created_at, status"
    )
    .eq("id", id)
    .single();

  if (error || !data) {
    return NextResponse.json({ error: "카드를 찾을 수 없습니다." }, { status: 404 });
  }

  if (data.status !== "public" || !data.expires_at || new Date(data.expires_at).getTime() <= Date.now()) {
    return NextResponse.json({ error: "공개 중인 카드가 아닙니다." }, { status: 403 });
  }

  let blurThumbUrl = "";
  if (data.blur_thumb_path) {
    blurThumbUrl = await createBlurThumbSignedUrl(adminClient, data.blur_thumb_path);
  }

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
      total_3lift: data.total_3lift,
      percent_all: data.percent_all,
      is_3lift_verified: data.is_3lift_verified,
      blur_thumb_url: blurThumbUrl,
      expires_at: data.expires_at,
      created_at: data.created_at,
    },
    can_apply: true,
  });
}
