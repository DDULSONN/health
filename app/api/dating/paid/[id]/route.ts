import { createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const admin = createAdminClient();

  const { data, error } = await admin
    .from("dating_paid_cards")
    .select(
      "id,nickname,gender,age,region,height_cm,job,training_years,strengths_text,ideal_text,intro_text,photo_visibility,blur_thumb_path,photo_paths,status,expires_at,paid_at,created_at"
    )
    .eq("id", id)
    .single();

  if (error || !data) {
    return NextResponse.json({ error: "카드를 찾을 수 없습니다." }, { status: 404 });
  }

  const now = Date.now();
  if (data.status !== "approved" || !data.expires_at || new Date(data.expires_at).getTime() <= now) {
    return NextResponse.json({ error: "지원 가능한 카드가 아닙니다." }, { status: 403 });
  }

  const firstPath =
    Array.isArray(data.photo_paths) && data.photo_paths.length > 0 && typeof data.photo_paths[0] === "string"
      ? data.photo_paths[0]
      : "";

  const createSignedUrl = async (path: string) => {
    const primary = await admin.storage.from("dating-card-photos").createSignedUrl(path, 3600);
    if (!primary.error && primary.data?.signedUrl) return primary.data.signedUrl;
    const legacy = await admin.storage.from("dating-photos").createSignedUrl(path, 3600);
    if (!legacy.error && legacy.data?.signedUrl) return legacy.data.signedUrl;
    return "";
  };

  let imageUrl = "";
  if (data.photo_visibility === "public" && firstPath) {
    imageUrl = await createSignedUrl(firstPath);
  } else if (data.blur_thumb_path) {
    imageUrl = await createSignedUrl(data.blur_thumb_path);
  }

  return NextResponse.json({
    card: {
      id: data.id,
      nickname: data.nickname,
      gender: data.gender,
      age: data.age,
      region: data.region,
      height_cm: data.height_cm,
      job: data.job,
      training_years: data.training_years,
      strengths_text: data.strengths_text,
      ideal_text: data.ideal_text,
      intro_text: data.intro_text,
      expires_at: data.expires_at,
      image_url: imageUrl,
      photo_visibility: data.photo_visibility === "public" ? "public" : "blur",
    },
  });
}
