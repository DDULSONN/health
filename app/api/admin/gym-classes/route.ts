import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireAdminRoute } from "@/lib/admin-route";
import { buildDefaultGymClassRefundPolicy, buildGymClassApplicationStats } from "@/lib/gym-class-rules";

type GymClassStatus = "draft" | "published" | "closed" | "canceled";
type GymHostType = "trainer" | "gym" | "brand" | "individual" | "other";
type GymSettlementStatus = "unsettled" | "pending" | "settled" | "hold";

type GymScheduleInput = {
  label?: unknown;
  starts_at?: unknown;
  ends_at?: unknown;
  capacity?: unknown;
};

type GymClassRow = {
  id: string;
  slug: string;
  title: string;
  host_name: string;
  host_type: GymHostType;
  status: GymClassStatus;
  summary: string | null;
  description: string | null;
  target_audience: string | null;
  service_process: string | null;
  curriculum: string | null;
  available_days: string | null;
  included_items: string | null;
  faq: string | null;
  expert_profile: string | null;
  purpose_tags: string[];
  region: string | null;
  venue: string | null;
  price_amount_krw: number | null;
  price_text: string | null;
  capacity: number | null;
  male_capacity: number | null;
  female_capacity: number | null;
  min_participants: number | null;
  application_deadline: string | null;
  contact_url: string | null;
  cover_image_url: string | null;
  preparation_note: string | null;
  refund_policy_text: string | null;
  refund_full_until_days: number;
  refund_half_until_days: number;
  no_refund_within_days: number;
  platform_fee_percent: number;
  settlement_status: GymSettlementStatus;
  settlement_total_paid_krw: number;
  settlement_platform_fee_krw: number;
  settlement_operator_amount_krw: number;
  settlement_note: string | null;
  settled_at: string | null;
  photo_consent_required: boolean;
  safety_notice: string | null;
  admin_note: string | null;
  auto_closed_at: string | null;
  operator_id: string | null;
  is_featured: boolean;
  created_by_user_id: string | null;
  created_at: string;
  updated_at: string;
};

type GymScheduleRow = {
  id: string;
  class_id: string;
  label: string | null;
  starts_at: string;
  ends_at: string | null;
  capacity: number | null;
  sort_order: number;
};

type GymApplicationRow = {
  id: string;
  class_id: string;
  status: string;
  gender: string | null;
  payment_status: string | null;
  paid_amount_krw: number | null;
  refund_amount_krw: number | null;
};

const STATUSES = new Set<GymClassStatus>(["draft", "published", "closed", "canceled"]);
const HOST_TYPES = new Set<GymHostType>(["trainer", "gym", "brand", "individual", "other"]);
const SETTLEMENT_STATUSES = new Set<GymSettlementStatus>(["unsettled", "pending", "settled", "hold"]);

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function cleanText(value: unknown, maxLength = 500) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, maxLength);
}

function requiredText(value: unknown, label: string, maxLength = 120) {
  const cleaned = cleanText(value, maxLength);
  if (!cleaned) {
    throw new Error(`${label}을 입력해 주세요.`);
  }
  return cleaned;
}

function cleanInteger(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) return null;
  return parsed;
}

function cleanNonNegativeInteger(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) return null;
  return parsed;
}

function cleanTextArray(value: unknown, maxItems = 8) {
  const values = Array.isArray(value) ? value : typeof value === "string" ? value.split(/[,\n]/) : [];
  return values
    .map((item) => cleanText(item, 40))
    .filter((item): item is string => Boolean(item))
    .slice(0, maxItems);
}

function cleanPercent(value: unknown, fallback = 10) {
  if (value === null || value === undefined || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100) return fallback;
  return Math.round(parsed * 100) / 100;
}

function cleanDate(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function cleanStatus(value: unknown): GymClassStatus {
  return typeof value === "string" && STATUSES.has(value as GymClassStatus) ? (value as GymClassStatus) : "draft";
}

function cleanHostType(value: unknown): GymHostType {
  return typeof value === "string" && HOST_TYPES.has(value as GymHostType) ? (value as GymHostType) : "trainer";
}

function cleanSettlementStatus(value: unknown): GymSettlementStatus {
  return typeof value === "string" && SETTLEMENT_STATUSES.has(value as GymSettlementStatus)
    ? (value as GymSettlementStatus)
    : "unsettled";
}

function normalizeSlug(value: unknown) {
  if (typeof value !== "string") return "";
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9가-힣-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
}

function defaultSlug() {
  return `class-${Date.now().toString(36)}`;
}

function isMissingTableError(error: { message?: string; code?: string } | null | undefined) {
  const message = String(error?.message ?? "");
  return error?.code === "42P01" || message.includes("gym_classes") || message.includes("schema cache");
}

async function buildUniqueSlug(admin: SupabaseClient, preferred: string) {
  const base = preferred || defaultSlug();
  for (let index = 0; index < 30; index += 1) {
    const candidate = index === 0 ? base : `${base}-${index + 1}`;
    const { data, error } = await admin.from("gym_classes").select("id").eq("slug", candidate).maybeSingle();
    if (error && !String(error.message).includes("multiple")) throw error;
    if (!data) return candidate;
  }
  return `${base}-${Date.now().toString(36)}`;
}

async function ensureClassCanOpen(admin: SupabaseClient, operatorId: string | null, status: GymClassStatus) {
  if (!operatorId) {
    if (status === "published") {
      throw new Error("모집중으로 열려면 승인된 운영자를 연결해 주세요.");
    }
    return;
  }

  const { data, error } = await admin
    .from("gym_class_operators")
    .select("id,status")
    .eq("id", operatorId)
    .maybeSingle();

  if (error) {
    throw new Error("운영자 확인에 실패했습니다.");
  }

  if (!data || data.status !== "active") {
    throw new Error("승인된 운영자만 클래스에 연결할 수 있습니다.");
  }
}

function buildClassPayload(body: Record<string, unknown>, userId: string) {
  const title = requiredText(body.title, "클래스명");
  const hostName = requiredText(body.host_name, "진행자명");

  return {
    title,
    host_name: hostName,
    host_type: cleanHostType(body.host_type),
    status: cleanStatus(body.status),
    summary: cleanText(body.summary, 240),
    description: cleanText(body.description, 3000),
    target_audience: cleanText(body.target_audience, 1200),
    service_process: cleanText(body.service_process, 2000),
    curriculum: cleanText(body.curriculum, 2000),
    available_days: cleanText(body.available_days, 1200),
    included_items: cleanText(body.included_items, 1200),
    faq: cleanText(body.faq, 2000),
    expert_profile: cleanText(body.expert_profile, 2000),
    purpose_tags: cleanTextArray(body.purpose_tags),
    region: cleanText(body.region, 80),
    venue: cleanText(body.venue, 180),
    price_amount_krw: cleanNonNegativeInteger(body.price_amount_krw),
    price_text: cleanText(body.price_text, 80),
    capacity: cleanInteger(body.capacity),
    male_capacity: cleanInteger(body.male_capacity),
    female_capacity: cleanInteger(body.female_capacity),
    min_participants: cleanInteger(body.min_participants),
    application_deadline: cleanDate(body.application_deadline),
    contact_url: cleanText(body.contact_url, 500),
    cover_image_url: cleanText(body.cover_image_url, 500),
    preparation_note: cleanText(body.preparation_note, 500),
    refund_policy_text:
      cleanText(body.refund_policy_text, 1000) ??
      buildDefaultGymClassRefundPolicy(cleanInteger(body.refund_full_until_days) ?? 3, cleanInteger(body.refund_half_until_days) ?? 2),
    refund_full_until_days: cleanInteger(body.refund_full_until_days) ?? 3,
    refund_half_until_days: cleanInteger(body.refund_half_until_days) ?? 2,
    no_refund_within_days: cleanInteger(body.no_refund_within_days) ?? 1,
    platform_fee_percent: cleanPercent(body.platform_fee_percent, 10),
    settlement_status: cleanSettlementStatus(body.settlement_status),
    settlement_total_paid_krw: cleanNonNegativeInteger(body.settlement_total_paid_krw) ?? 0,
    settlement_platform_fee_krw: cleanNonNegativeInteger(body.settlement_platform_fee_krw) ?? 0,
    settlement_operator_amount_krw: cleanNonNegativeInteger(body.settlement_operator_amount_krw) ?? 0,
    settlement_note: cleanText(body.settlement_note, 1000),
    settled_at: cleanDate(body.settled_at),
    photo_consent_required: body.photo_consent_required === true,
    safety_notice: cleanText(body.safety_notice, 1000),
    admin_note: cleanText(body.admin_note, 1000),
    operator_id: cleanText(body.operator_id, 80),
    is_featured: body.is_featured === true,
    created_by_user_id: userId,
    updated_at: new Date().toISOString(),
  };
}

function buildSchedulePayloads(classId: string, schedules: unknown) {
  if (!Array.isArray(schedules)) return [];

  return schedules
    .map((item, index) => {
      const row = asRecord(item);
      const startsAt = cleanDate(row.starts_at);
      if (!startsAt) return null;

      return {
        class_id: classId,
        label: cleanText(row.label, 80),
        starts_at: startsAt,
        ends_at: cleanDate(row.ends_at),
        capacity: cleanInteger(row.capacity),
        sort_order: index,
      };
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item));
}

async function attachChildren(admin: SupabaseClient, classes: GymClassRow[]) {
  const ids = classes.map((item) => item.id);
  if (ids.length === 0) return [];

  const [{ data: schedules }, { data: applications }] = await Promise.all([
    admin
      .from("gym_class_schedules")
      .select("id,class_id,label,starts_at,ends_at,capacity,sort_order")
      .in("class_id", ids)
      .order("sort_order", { ascending: true })
      .order("starts_at", { ascending: true }),
    admin
      .from("gym_class_applications")
      .select("id,class_id,status,gender,payment_status,paid_amount_krw,refund_amount_krw")
      .in("class_id", ids),
  ]);

  const schedulesByClass = new Map<string, GymScheduleRow[]>();
  for (const schedule of ((schedules ?? []) as GymScheduleRow[])) {
    schedulesByClass.set(schedule.class_id, [...(schedulesByClass.get(schedule.class_id) ?? []), schedule]);
  }

  const applicationsByClass = new Map<string, GymApplicationRow[]>();
  for (const application of ((applications ?? []) as GymApplicationRow[])) {
    applicationsByClass.set(application.class_id, [...(applicationsByClass.get(application.class_id) ?? []), application]);
  }

  return classes.map((item) => ({
    ...item,
    schedules: schedulesByClass.get(item.id) ?? [],
    application_stats: buildGymClassApplicationStats(applicationsByClass.get(item.id) ?? [], item),
  }));
}

export async function GET() {
  const auth = await requireAdminRoute();
  if (!auth.ok) return auth.response;

  const { data, error } = await auth.admin
    .from("gym_classes")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(120);

  if (error) {
    return NextResponse.json(
      {
        error: isMissingTableError(error)
          ? "운동 클래스 SQL을 먼저 적용해 주세요."
          : "운동 클래스 목록을 불러오지 못했습니다.",
        detail: error.message,
      },
      { status: 500 },
    );
  }

  const items = await attachChildren(auth.admin, (data ?? []) as GymClassRow[]);
  return NextResponse.json({ items });
}

export async function POST(req: Request) {
  const auth = await requireAdminRoute();
  if (!auth.ok) return auth.response;

  try {
    const body = asRecord(await req.json());
    const payload = buildClassPayload(body, auth.user.id);
    const slug = await buildUniqueSlug(auth.admin, normalizeSlug(body.slug));
    await ensureClassCanOpen(auth.admin, payload.operator_id, payload.status);

    const { data, error } = await auth.admin
      .from("gym_classes")
      .insert({ ...payload, slug })
      .select("*")
      .single();

    if (error) {
      return NextResponse.json({ error: "운동 클래스 저장에 실패했습니다.", detail: error.message }, { status: 500 });
    }

    const schedules = buildSchedulePayloads(data.id, body.schedules);
    if (schedules.length > 0) {
      const { error: scheduleError } = await auth.admin.from("gym_class_schedules").insert(schedules);
      if (scheduleError) {
        return NextResponse.json({ error: "일정 저장에 실패했습니다.", detail: scheduleError.message }, { status: 500 });
      }
    }

    const [item] = await attachChildren(auth.admin, [data as GymClassRow]);
    return NextResponse.json({ item });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "운동 클래스 저장에 실패했습니다." },
      { status: 400 },
    );
  }
}
