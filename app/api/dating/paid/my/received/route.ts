import { createAdminClient, createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

async function createApplyPhotoSignedUrl(adminClient: ReturnType<typeof createAdminClient>, path: string) {
  const primary = await adminClient.storage.from("dating-apply-photos").createSignedUrl(path, 3600);
  if (!primary.error && primary.data?.signedUrl) return primary.data.signedUrl;
  const legacy = await adminClient.storage.from("dating-photos").createSignedUrl(path, 3600);
  if (!legacy.error && legacy.data?.signedUrl) return legacy.data.signedUrl;
  return "";
}

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  const admin = createAdminClient();
  const { data: cards, error: cardsError } = await admin
    .from("dating_paid_cards")
    .select("id,nickname,gender,age,region,expires_at,created_at,status")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  if (cardsError) {
    console.error("[GET /api/dating/paid/my/received] cards failed", cardsError);
    return NextResponse.json({ error: "내 유료카드를 불러오지 못했습니다." }, { status: 500 });
  }

  const cardIds = (cards ?? []).map((c) => c.id);
  if (cardIds.length === 0) return NextResponse.json({ cards: [], applications: [] });

  const { data: apps, error: appsError } = await admin
    .from("dating_paid_card_applications")
    .select("id,paid_card_id,applicant_user_id,applicant_display_nickname,age,height_cm,region,job,training_years,intro_text,status,created_at,instagram_id,photo_paths")
    .in("paid_card_id", cardIds)
    .order("created_at", { ascending: false });

  if (appsError) {
    console.error("[GET /api/dating/paid/my/received] apps failed", appsError);
    return NextResponse.json({ error: "유료 지원자 목록을 불러오지 못했습니다." }, { status: 500 });
  }

  const safeApps = await Promise.all(
    (apps ?? []).map(async (app) => {
      const rawPaths = Array.isArray(app.photo_paths)
        ? app.photo_paths.filter((item): item is string => typeof item === "string" && item.length > 0)
        : [];
      const signed = await Promise.all(rawPaths.map((p) => createApplyPhotoSignedUrl(admin, p)));
      return {
        ...app,
        card_id: app.paid_card_id,
        instagram_id: app.status === "accepted" ? app.instagram_id : null,
        photo_signed_urls: signed.filter((u) => u.length > 0),
      };
    })
  );

  return NextResponse.json({ cards: cards ?? [], applications: safeApps });
}
