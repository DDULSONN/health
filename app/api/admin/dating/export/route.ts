import { isAllowedAdminUser } from "@/lib/admin";
import { getRequestAuthContext } from "@/lib/supabase/request";
import { createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

type ExportKind =
  | "open_cards"
  | "paid_cards"
  | "one_on_one_cards"
  | "one_on_one_matches"
  | "ideal_preferences"
  | "more_view_requests"
  | "city_view_requests";

const BATCH_SIZE = 1000;

function escapeCsvCell(value: unknown): string {
  const text = value == null ? "" : String(value);
  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function buildCsv(headers: string[], rows: Array<Array<unknown>>): string {
  const lines = [
    headers.map(escapeCsvCell).join(","),
    ...rows.map((row) => row.map(escapeCsvCell).join(",")),
  ];
  return `\uFEFF${lines.join("\r\n")}`;
}

function fileNameFor(kind: ExportKind) {
  const date = new Date().toISOString().slice(0, 10);
  return `dating-${kind}-${date}.csv`;
}

function toCurrentAgeFromBirthYear(value: unknown) {
  const birthYear = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(birthYear) || birthYear <= 0) return "";
  return new Date().getFullYear() - birthYear + 1;
}

async function fetchAllRows(
  table: string,
  select: string,
  orderColumn: string,
  ascending = false
) {
  const admin = createAdminClient();
  const rows: Record<string, unknown>[] = [];
  let from = 0;

  while (true) {
    const { data, error } = await admin
      .from(table)
      .select(select)
      .order(orderColumn, { ascending })
      .range(from, from + BATCH_SIZE - 1);

    if (error) throw error;
    const batch = Array.isArray(data) ? (data as unknown as Record<string, unknown>[]) : [];
    rows.push(...batch);
    if (batch.length < BATCH_SIZE) break;
    from += BATCH_SIZE;
  }

  return rows;
}

async function fetchNicknameMap(userIds: string[]) {
  const uniqueIds = [...new Set(userIds.filter(Boolean))];
  if (uniqueIds.length === 0) return new Map<string, string | null>();
  const admin = createAdminClient();
  const { data, error } = await admin.from("profiles").select("user_id,nickname").in("user_id", uniqueIds);
  if (error) throw error;

  return new Map(
    (Array.isArray(data) ? data : []).map((row) => [
      String((row as { user_id?: unknown }).user_id ?? ""),
      ((row as { nickname?: unknown }).nickname as string | null | undefined) ?? null,
    ])
  );
}

async function exportOpenCards() {
  const rows = await fetchAllRows(
    "dating_cards",
    "id,owner_user_id,sex,display_nickname,age,region,height_cm,job,training_years,strengths_text,ideal_type,instagram_id,total_3lift,percent_all,is_3lift_verified,status,published_at,expires_at,created_at",
    "created_at"
  );

  const headers = [
    "card_id",
    "user_id",
    "nickname",
    "sex",
    "age",
    "region",
    "height_cm",
    "job",
    "training_years",
    "strengths_text",
    "ideal_type",
    "instagram_id",
    "total_3lift",
    "percent_all",
    "is_3lift_verified",
    "status",
    "published_at",
    "expires_at",
    "created_at",
  ];

  const dataRows = rows.map((row) => [
    row.id,
    row.owner_user_id,
    row.display_nickname,
    row.sex,
    row.age,
    row.region,
    row.height_cm,
    row.job,
    row.training_years,
    row.strengths_text,
    row.ideal_type,
    row.instagram_id,
    row.total_3lift,
    row.percent_all,
    row.is_3lift_verified,
    row.status,
    row.published_at,
    row.expires_at,
    row.created_at,
  ]);

  return buildCsv(headers, dataRows);
}

async function exportPaidCards() {
  const rows = await fetchAllRows(
    "dating_paid_cards",
    "id,user_id,nickname,gender,age,region,height_cm,job,training_years,strengths_text,ideal_text,intro_text,instagram_id,photo_visibility,display_mode,status,paid_at,expires_at,created_at",
    "created_at"
  );

  const headers = [
    "card_id",
    "user_id",
    "nickname",
    "gender",
    "age",
    "region",
    "height_cm",
    "job",
    "training_years",
    "strengths_text",
    "ideal_text",
    "intro_text",
    "instagram_id",
    "photo_visibility",
    "display_mode",
    "status",
    "paid_at",
    "expires_at",
    "created_at",
  ];

  const dataRows = rows.map((row) => [
    row.id,
    row.user_id,
    row.nickname,
    row.gender,
    row.age,
    row.region,
    row.height_cm,
    row.job,
    row.training_years,
    row.strengths_text,
    row.ideal_text,
    row.intro_text,
    row.instagram_id,
    row.photo_visibility,
    row.display_mode,
    row.status,
    row.paid_at,
    row.expires_at,
    row.created_at,
  ]);

  return buildCsv(headers, dataRows);
}

async function exportOneOnOneCards() {
  const rows = await fetchAllRows(
    "dating_1on1_cards",
    "id,user_id,sex,name,birth_year,height_cm,job,region,phone,intro_text,strengths_text,preferred_partner_text,smoking,workout_frequency,status,admin_note,admin_tags,reviewed_by_user_id,reviewed_at,created_at",
    "created_at"
  );

  const headers = [
    "card_id",
    "user_id",
    "sex",
    "name",
    "birth_year",
    "height_cm",
    "job",
    "region",
    "phone",
    "intro_text",
    "strengths_text",
    "preferred_partner_text",
    "smoking",
    "workout_frequency",
    "status",
    "admin_note",
    "admin_tags",
    "reviewed_by_user_id",
    "reviewed_at",
    "created_at",
  ];

  const dataRows = rows.map((row) => [
    row.id,
    row.user_id,
    row.sex,
    row.name,
    row.birth_year,
    row.height_cm,
    row.job,
    row.region,
    row.phone,
    row.intro_text,
    row.strengths_text,
    row.preferred_partner_text,
    row.smoking,
    row.workout_frequency,
    row.status,
    row.admin_note,
    Array.isArray(row.admin_tags) ? row.admin_tags.join(" | ") : "",
    row.reviewed_by_user_id,
    row.reviewed_at,
    row.created_at,
  ]);

  return buildCsv(headers, dataRows);
}

async function exportOneOnOneMatches() {
  const rows = await fetchAllRows(
    "dating_1on1_match_proposals",
    "id,source_card_id,source_user_id,candidate_card_id,candidate_user_id,state,admin_sent_by_user_id,source_selected_at,candidate_responded_at,source_final_responded_at,created_at,updated_at",
    "created_at"
  );

  const headers = [
    "match_id",
    "source_card_id",
    "source_user_id",
    "candidate_card_id",
    "candidate_user_id",
    "state",
    "admin_sent_by_user_id",
    "source_selected_at",
    "candidate_responded_at",
    "source_final_responded_at",
    "created_at",
    "updated_at",
  ];

  const dataRows = rows.map((row) => [
    row.id,
    row.source_card_id,
    row.source_user_id,
    row.candidate_card_id,
    row.candidate_user_id,
    row.state,
    row.admin_sent_by_user_id,
    row.source_selected_at,
    row.candidate_responded_at,
    row.source_final_responded_at,
    row.created_at,
    row.updated_at,
  ]);

  return buildCsv(headers, dataRows);
}

async function exportIdealPreferences() {
  const [openRows, paidRows, oneOnOneRows] = await Promise.all([
    fetchAllRows(
      "dating_cards",
      "id,owner_user_id,sex,display_nickname,age,region,height_cm,job,training_years,strengths_text,ideal_type,status,created_at",
      "created_at"
    ),
    fetchAllRows(
      "dating_paid_cards",
      "id,user_id,nickname,gender,age,region,height_cm,job,training_years,strengths_text,ideal_text,intro_text,status,created_at",
      "created_at"
    ),
    fetchAllRows(
      "dating_1on1_cards",
      "id,user_id,sex,name,birth_year,height_cm,job,region,intro_text,strengths_text,preferred_partner_text,status,created_at",
      "created_at"
    ),
  ]);

  const headers = [
    "source_type",
    "card_id",
    "user_id",
    "sex",
    "display_name",
    "age",
    "region",
    "height_cm",
    "job",
    "training_years",
    "self_intro_or_strengths",
    "ideal_preference_text",
    "status",
    "created_at",
  ];

  const dataRows: Array<Array<unknown>> = [
    ...openRows.map((row) => [
      "open_card",
      row.id,
      row.owner_user_id,
      row.sex,
      row.display_nickname,
      row.age,
      row.region,
      row.height_cm,
      row.job,
      row.training_years,
      row.strengths_text,
      row.ideal_type,
      row.status,
      row.created_at,
    ]),
    ...paidRows.map((row) => [
      "paid_card",
      row.id,
      row.user_id,
      row.gender,
      row.nickname,
      row.age,
      row.region,
      row.height_cm,
      row.job,
      row.training_years,
      [row.intro_text, row.strengths_text].filter(Boolean).join(" | "),
      row.ideal_text,
      row.status,
      row.created_at,
    ]),
    ...oneOnOneRows.map((row) => [
      "one_on_one",
      row.id,
      row.user_id,
      row.sex,
      row.name,
      toCurrentAgeFromBirthYear(row.birth_year),
      row.region,
      row.height_cm,
      row.job,
      "",
      [row.intro_text, row.strengths_text].filter(Boolean).join(" | "),
      row.preferred_partner_text,
      row.status,
      row.created_at,
    ]),
  ];

  return buildCsv(headers, dataRows);
}

async function exportMoreViewRequests() {
  const rows = await fetchAllRows(
    "dating_more_view_requests",
    "id,user_id,sex,status,note,created_at,reviewed_at,reviewed_by_user_id,access_expires_at",
    "created_at"
  );
  const nicknameMap = await fetchNicknameMap(rows.map((row) => String(row.user_id ?? "")));

  const headers = [
    "request_id",
    "user_id",
    "nickname",
    "sex",
    "status",
    "note",
    "created_at",
    "reviewed_at",
    "reviewed_by_user_id",
    "access_expires_at",
  ];

  const dataRows = rows.map((row) => [
    row.id,
    row.user_id,
    nicknameMap.get(String(row.user_id ?? "")) ?? "",
    row.sex,
    row.status,
    row.note,
    row.created_at,
    row.reviewed_at,
    row.reviewed_by_user_id,
    row.access_expires_at,
  ]);

  return buildCsv(headers, dataRows);
}

async function exportCityViewRequests() {
  const rows = await fetchAllRows(
    "dating_city_view_requests",
    "id,user_id,city,status,note,created_at,reviewed_at,access_expires_at",
    "created_at"
  );
  const nicknameMap = await fetchNicknameMap(rows.map((row) => String(row.user_id ?? "")));

  const headers = [
    "request_id",
    "user_id",
    "nickname",
    "city",
    "status",
    "note",
    "created_at",
    "reviewed_at",
    "access_expires_at",
  ];

  const dataRows = rows.map((row) => [
    row.id,
    row.user_id,
    nicknameMap.get(String(row.user_id ?? "")) ?? "",
    row.city,
    row.status,
    row.note,
    row.created_at,
    row.reviewed_at,
    row.access_expires_at,
  ]);

  return buildCsv(headers, dataRows);
}

export async function GET(req: Request) {
  const { user } = await getRequestAuthContext(req);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isAllowedAdminUser(user.id, user.email)) {
    return NextResponse.json({ error: "Admin only" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const kind = (searchParams.get("kind") ?? "").trim() as ExportKind;

  try {
    let csv = "";
    if (kind === "open_cards") {
      csv = await exportOpenCards();
    } else if (kind === "paid_cards") {
      csv = await exportPaidCards();
    } else if (kind === "one_on_one_cards") {
      csv = await exportOneOnOneCards();
    } else if (kind === "one_on_one_matches") {
      csv = await exportOneOnOneMatches();
    } else if (kind === "ideal_preferences") {
      csv = await exportIdealPreferences();
    } else if (kind === "more_view_requests") {
      csv = await exportMoreViewRequests();
    } else if (kind === "city_view_requests") {
      csv = await exportCityViewRequests();
    } else {
      return NextResponse.json({ error: "Invalid export kind." }, { status: 400 });
    }

    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${fileNameFor(kind)}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error("[GET /api/admin/dating/export] failed", { kind, error });
    return NextResponse.json({ error: "Failed to export dating data." }, { status: 500 });
  }
}
