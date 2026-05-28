import { isAllowedAdminUser } from "@/lib/admin";
import { getRequestAuthContext } from "@/lib/supabase/request";
import { createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

type SourceKind = "open_card" | "paid_card";

type AcceptedOpenApplicationRow = {
  id: string;
  card_id: string;
  applicant_user_id: string;
  applicant_display_nickname: string | null;
  age: number | null;
  height_cm: number | null;
  region: string | null;
  job: string | null;
  training_years: number | null;
  intro_text: string | null;
  instagram_id: string | null;
  status: string | null;
  created_at: string;
  accepted_at: string | null;
};

type AcceptedPaidApplicationRow = Omit<AcceptedOpenApplicationRow, "card_id"> & {
  paid_card_id: string;
};

type OpenCardRow = {
  id: string;
  owner_user_id: string;
  display_nickname: string | null;
  sex: "male" | "female" | null;
  status: string | null;
  region: string | null;
};

type PaidCardRow = {
  id: string;
  user_id: string;
  nickname: string | null;
  gender: "M" | "F" | null;
  status: string | null;
};

type ProfileRow = {
  user_id: string;
  nickname: string | null;
};

function getErrorCode(error: unknown) {
  if (!error || typeof error !== "object") return "";
  return String((error as { code?: unknown }).code ?? "");
}

function isMissingAcceptedAtError(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const code = getErrorCode(error);
  const message = String((error as { message?: unknown }).message ?? "");
  return code === "42703" || code === "PGRST204" || message.includes("accepted_at");
}

function compactIds(ids: Array<string | null | undefined>) {
  return [...new Set(ids.map((id) => String(id ?? "").trim()).filter(Boolean))];
}

function toSexLabel(value: string | null | undefined) {
  if (value === "male" || value === "M") return "남자";
  if (value === "female" || value === "F") return "여자";
  return null;
}

function daysAgoIso(days: number) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

async function fetchProfiles(admin: ReturnType<typeof createAdminClient>, userIds: string[]) {
  if (userIds.length === 0) return new Map<string, string | null>();
  const res = await admin.from("profiles").select("user_id,nickname").in("user_id", userIds);
  if (res.error) {
    console.error("[GET /api/admin/dating/accepted-applications/recent] profiles failed", res.error);
    return new Map<string, string | null>();
  }
  return new Map(((res.data ?? []) as ProfileRow[]).map((row) => [row.user_id, row.nickname]));
}

async function fetchOpenApplications(admin: ReturnType<typeof createAdminClient>, sinceIso: string) {
  const acceptedAtRes = await admin
    .from("dating_card_applications")
    .select(
      "id,card_id,applicant_user_id,applicant_display_nickname,age,height_cm,region,job,training_years,intro_text,instagram_id,status,created_at,accepted_at"
    )
    .eq("status", "accepted")
    .gte("accepted_at", sinceIso)
    .order("accepted_at", { ascending: false })
    .limit(500);

  if (acceptedAtRes.error && isMissingAcceptedAtError(acceptedAtRes.error)) {
    const fallbackRes = await admin
      .from("dating_card_applications")
      .select(
        "id,card_id,applicant_user_id,applicant_display_nickname,age,height_cm,region,job,training_years,intro_text,instagram_id,status,created_at"
      )
      .eq("status", "accepted")
      .gte("created_at", sinceIso)
      .order("created_at", { ascending: false })
      .limit(500);

    return {
      data: ((fallbackRes.data ?? []) as Omit<AcceptedOpenApplicationRow, "accepted_at">[]).map((row) => ({
        ...row,
        accepted_at: null,
      })),
      error: fallbackRes.error,
      fallback: true,
    };
  }

  if (acceptedAtRes.error) {
    return { data: [], error: acceptedAtRes.error, fallback: false };
  }

  const nullAcceptedAtRes = await admin
    .from("dating_card_applications")
    .select(
      "id,card_id,applicant_user_id,applicant_display_nickname,age,height_cm,region,job,training_years,intro_text,instagram_id,status,created_at,accepted_at"
    )
    .eq("status", "accepted")
    .is("accepted_at", null)
    .gte("created_at", sinceIso)
    .order("created_at", { ascending: false })
    .limit(500);

  if (nullAcceptedAtRes.error) {
    return { data: acceptedAtRes.data as AcceptedOpenApplicationRow[], error: nullAcceptedAtRes.error, fallback: false };
  }

  const byId = new Map<string, AcceptedOpenApplicationRow>();
  for (const row of (acceptedAtRes.data ?? []) as AcceptedOpenApplicationRow[]) byId.set(row.id, row);
  for (const row of (nullAcceptedAtRes.data ?? []) as AcceptedOpenApplicationRow[]) byId.set(row.id, row);

  return {
    data: [...byId.values()],
    error: null,
    fallback: (nullAcceptedAtRes.data ?? []).length > 0,
  };
}

async function fetchPaidApplications(admin: ReturnType<typeof createAdminClient>, sinceIso: string) {
  const acceptedAtRes = await admin
    .from("dating_paid_card_applications")
    .select(
      "id,paid_card_id,applicant_user_id,applicant_display_nickname,age,height_cm,region,job,training_years,intro_text,instagram_id,status,created_at,accepted_at"
    )
    .eq("status", "accepted")
    .gte("accepted_at", sinceIso)
    .order("accepted_at", { ascending: false })
    .limit(500);

  if (acceptedAtRes.error && isMissingAcceptedAtError(acceptedAtRes.error)) {
    const fallbackRes = await admin
      .from("dating_paid_card_applications")
      .select(
        "id,paid_card_id,applicant_user_id,applicant_display_nickname,age,height_cm,region,job,training_years,intro_text,instagram_id,status,created_at"
      )
      .eq("status", "accepted")
      .gte("created_at", sinceIso)
      .order("created_at", { ascending: false })
      .limit(500);

    return {
      data: ((fallbackRes.data ?? []) as Omit<AcceptedPaidApplicationRow, "accepted_at">[]).map((row) => ({
        ...row,
        accepted_at: null,
      })),
      error: fallbackRes.error,
      fallback: true,
    };
  }

  if (acceptedAtRes.error) {
    return { data: [], error: acceptedAtRes.error, fallback: false };
  }

  const nullAcceptedAtRes = await admin
    .from("dating_paid_card_applications")
    .select(
      "id,paid_card_id,applicant_user_id,applicant_display_nickname,age,height_cm,region,job,training_years,intro_text,instagram_id,status,created_at,accepted_at"
    )
    .eq("status", "accepted")
    .is("accepted_at", null)
    .gte("created_at", sinceIso)
    .order("created_at", { ascending: false })
    .limit(500);

  if (nullAcceptedAtRes.error) {
    return { data: acceptedAtRes.data as AcceptedPaidApplicationRow[], error: nullAcceptedAtRes.error, fallback: false };
  }

  const byId = new Map<string, AcceptedPaidApplicationRow>();
  for (const row of (acceptedAtRes.data ?? []) as AcceptedPaidApplicationRow[]) byId.set(row.id, row);
  for (const row of (nullAcceptedAtRes.data ?? []) as AcceptedPaidApplicationRow[]) byId.set(row.id, row);

  return {
    data: [...byId.values()],
    error: null,
    fallback: (nullAcceptedAtRes.data ?? []).length > 0,
  };
}

export async function GET(req: Request) {
  const { user } = await getRequestAuthContext(req);
  if (!user || !isAllowedAdminUser(user.id, user.email)) {
    return NextResponse.json({ error: "권한이 없습니다." }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const daysRaw = Number(searchParams.get("days") ?? 7);
  const days = Number.isFinite(daysRaw) ? Math.max(1, Math.min(30, Math.round(daysRaw))) : 7;
  const sinceIso = daysAgoIso(days);
  const admin = createAdminClient();

  const [openRes, paidRes] = await Promise.all([
    fetchOpenApplications(admin, sinceIso),
    fetchPaidApplications(admin, sinceIso),
  ]);

  if (openRes.error || paidRes.error) {
    console.error("[GET /api/admin/dating/accepted-applications/recent] failed", {
      openError: openRes.error,
      paidError: paidRes.error,
    });
    return NextResponse.json({ error: "최근 수락된 지원서를 불러오지 못했습니다." }, { status: 500 });
  }

  const openCardIds = compactIds(openRes.data.map((app) => app.card_id));
  const paidCardIds = compactIds(paidRes.data.map((app) => app.paid_card_id));

  const [openCardsRes, paidCardsRes] = await Promise.all([
    openCardIds.length
      ? admin.from("dating_cards").select("id,owner_user_id,display_nickname,sex,status,region").in("id", openCardIds)
      : Promise.resolve({ data: [], error: null }),
    paidCardIds.length
      ? admin.from("dating_paid_cards").select("id,user_id,nickname,gender,status").in("id", paidCardIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (openCardsRes.error || paidCardsRes.error) {
    console.error("[GET /api/admin/dating/accepted-applications/recent] cards failed", {
      openCardsError: openCardsRes.error,
      paidCardsError: paidCardsRes.error,
    });
    return NextResponse.json({ error: "수락된 지원서의 카드 정보를 불러오지 못했습니다." }, { status: 500 });
  }

  const openCards = (openCardsRes.data ?? []) as OpenCardRow[];
  const paidCards = (paidCardsRes.data ?? []) as PaidCardRow[];
  const openCardMap = new Map(openCards.map((card) => [card.id, card]));
  const paidCardMap = new Map(paidCards.map((card) => [card.id, card]));
  const profileMap = await fetchProfiles(
    admin,
    compactIds([
      ...openRes.data.map((app) => app.applicant_user_id),
      ...paidRes.data.map((app) => app.applicant_user_id),
      ...openCards.map((card) => card.owner_user_id),
      ...paidCards.map((card) => card.user_id),
    ])
  );

  const openItems = openRes.data.map((app) => {
    const card = openCardMap.get(app.card_id);
    return {
      source_kind: "open_card" as SourceKind,
      id: app.id,
      application_id: app.id,
      card_id: app.card_id,
      applicant_user_id: app.applicant_user_id,
      applicant_nickname: profileMap.get(app.applicant_user_id) ?? null,
      applicant_display_nickname: app.applicant_display_nickname,
      age: app.age,
      height_cm: app.height_cm,
      region: app.region,
      job: app.job,
      training_years: app.training_years,
      intro_text: app.intro_text,
      instagram_id: app.instagram_id ?? "",
      created_at: app.created_at,
      accepted_at: app.accepted_at,
      card_owner_user_id: card?.owner_user_id ?? null,
      card_owner_nickname: card?.owner_user_id ? profileMap.get(card.owner_user_id) ?? null : null,
      card_display_name: card?.display_nickname ?? null,
      card_sex_label: toSexLabel(card?.sex),
      card_status: card?.status ?? null,
      card_region: card?.region ?? null,
    };
  });

  const paidItems = paidRes.data.map((app) => {
    const card = paidCardMap.get(app.paid_card_id);
    return {
      source_kind: "paid_card" as SourceKind,
      id: app.id,
      application_id: app.id,
      card_id: app.paid_card_id,
      applicant_user_id: app.applicant_user_id,
      applicant_nickname: profileMap.get(app.applicant_user_id) ?? null,
      applicant_display_nickname: app.applicant_display_nickname,
      age: app.age,
      height_cm: app.height_cm,
      region: app.region,
      job: app.job,
      training_years: app.training_years,
      intro_text: app.intro_text,
      instagram_id: app.instagram_id ?? "",
      created_at: app.created_at,
      accepted_at: app.accepted_at,
      card_owner_user_id: card?.user_id ?? null,
      card_owner_nickname: card?.user_id ? profileMap.get(card.user_id) ?? null : null,
      card_display_name: card?.nickname ?? null,
      card_sex_label: toSexLabel(card?.gender),
      card_status: card?.status ?? null,
      card_region: null,
    };
  });

  const items = [...openItems, ...paidItems].sort((a, b) => {
    const aTime = new Date(a.accepted_at ?? a.created_at).getTime();
    const bTime = new Date(b.accepted_at ?? b.created_at).getTime();
    return bTime - aTime;
  });

  return NextResponse.json({
    items,
    range: {
      sinceIso,
      days,
    },
    fallback_created_at: openRes.fallback || paidRes.fallback,
  });
}
