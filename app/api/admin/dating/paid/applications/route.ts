import { isAdminEmail } from "@/lib/admin";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

function json(status: number, payload: Record<string, unknown>) {
  return NextResponse.json(payload, { status });
}

function parseAdminUserIds() {
  return (process.env.ADMIN_USER_IDS ?? "")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
}

function isAllowedAdmin(userId: string, email?: string | null) {
  const allowlist = parseAdminUserIds();
  if (allowlist.length > 0) {
    return allowlist.includes(userId);
  }
  return isAdminEmail(email);
}

type PaidApplicationRow = {
  id: string;
  paid_card_id: string;
  applicant_user_id: string;
  applicant_display_nickname: string | null;
  age: number | null;
  height_cm: number | null;
  region: string | null;
  job: string | null;
  training_years: number | null;
  intro_text: string | null;
  instagram_id: string | null;
  photo_paths: string[] | null;
  status: "submitted" | "accepted" | "rejected" | "canceled";
  created_at: string;
};

export async function GET() {
  const requestId = crypto.randomUUID();
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return json(401, { error: "로그인이 필요합니다.", requestId });
    }
    if (!isAllowedAdmin(user.id, user.email)) {
      return json(403, { error: "권한이 없습니다.", requestId });
    }

    const admin = createAdminClient();
    const appsRes = await admin
      .from("dating_paid_card_applications")
      .select(
        "id,paid_card_id,applicant_user_id,applicant_display_nickname,age,height_cm,region,job,training_years,intro_text,instagram_id,photo_paths,status,created_at"
      )
      .order("created_at", { ascending: false })
      .limit(5000);

    if (appsRes.error) {
      console.error("[GET /api/admin/dating/paid/applications] apps failed", appsRes.error);
      return json(500, { error: "24시간 카드 지원 이력을 불러오지 못했습니다.", requestId });
    }

    const apps = (appsRes.data ?? []) as PaidApplicationRow[];
    if (apps.length === 0) {
      return json(200, { items: [], requestId });
    }

    const paidCardIds = [...new Set(apps.map((app) => app.paid_card_id))];
    const cardsRes = await admin
      .from("dating_paid_cards")
      .select("id,user_id,nickname,gender,status")
      .in("id", paidCardIds);

    if (cardsRes.error) {
      console.error("[GET /api/admin/dating/paid/applications] cards failed", cardsRes.error);
      return json(500, { error: "24시간 카드 정보를 불러오지 못했습니다.", requestId });
    }

    const cards = cardsRes.data ?? [];
    const cardsById = Object.fromEntries(cards.map((card) => [card.id, card]));

    const userIds = [...new Set([...apps.map((app) => app.applicant_user_id), ...cards.map((card) => card.user_id)])];
    let nicknameByUserId: Record<string, string> = {};
    if (userIds.length > 0) {
      const profilesRes = await admin.from("profiles").select("user_id,nickname").in("user_id", userIds);
      if (!profilesRes.error) {
        nicknameByUserId = Object.fromEntries((profilesRes.data ?? []).map((p) => [p.user_id, p.nickname]));
      }
    }

    const items = apps.map((app) => {
      const card = cardsById[app.paid_card_id];
      return {
        id: app.id,
        card_id: app.paid_card_id,
        applicant_user_id: app.applicant_user_id,
        applicant_nickname: nicknameByUserId[app.applicant_user_id] ?? null,
        applicant_display_nickname: app.applicant_display_nickname,
        age: app.age,
        height_cm: app.height_cm,
        region: app.region,
        job: app.job,
        training_years: app.training_years,
        intro_text: app.intro_text,
        instagram_id: app.instagram_id ?? "",
        photo_paths: Array.isArray(app.photo_paths) ? app.photo_paths : [],
        status: app.status,
        created_at: app.created_at,
        card_owner_user_id: card?.user_id ?? null,
        card_owner_nickname: card?.user_id ? nicknameByUserId[card.user_id] ?? null : null,
        card_nickname: card?.nickname ?? null,
        card_gender: card?.gender ?? null,
        card_status: card?.status ?? null,
      };
    });

    return json(200, { items, requestId });
  } catch (error) {
    console.error("[GET /api/admin/dating/paid/applications] unhandled", error);
    return json(500, { error: "서버 오류가 발생했습니다." });
  }
}
