import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireAdminRoute } from "@/lib/admin-route";
import { buildDefaultGymClassRefundPolicy, buildGymClassApplicationStats } from "@/lib/gym-class-rules";

type RouteContext = {
  params: Promise<{ id: string }>;
};

type GymClassStatus = "draft" | "published" | "closed" | "canceled";
type GymHostType = "trainer" | "gym" | "brand" | "individual" | "other";
type GymSettlementStatus = "unsettled" | "pending" | "settled" | "hold";

const STATUSES = new Set<GymClassStatus>(["draft", "published", "closed", "canceled"]);
const HOST_TYPES = new Set<GymHostType>(["trainer", "gym", "brand", "individual", "other"]);
const SETTLEMENT_STATUSES = new Set<GymSettlementStatus>(["unsettled", "pending", "settled", "hold"]);

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function cleanText(value: unknown, maxLength = 500) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, maxLength) : null;
}

function requiredText(value: unknown, label: string, maxLength = 120) {
  const cleaned = cleanText(value, maxLength);
  if (!cleaned) throw new Error(`${label}을 입력해 주세요.`);
  return cleaned;
}

function cleanInteger(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function cleanNonNegativeInteger(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
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
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
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

function normalizeSlug(value: unknown) {
  if (typeof value !== "string") return null;
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9가-힣-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
  return slug || null;
}

function buildUpdatePayload(body: Record<string, unknown>) {
  return {
    title: requiredText(body.title, "클래스명"),
    host_name: requiredText(body.host_name, "진행자명"),
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

async function getClassDetail(admin: SupabaseClient, id: string) {
  const { data: item, error } = await admin.from("gym_classes").select("*").eq("id", id).single();
  if (error || !item) {
    return { error: error?.message ?? "not_found", item: null };
  }

  const [{ data: schedules }, { data: applications }, { data: reviews }, { data: reports }, { data: inquiries }, { data: waitlist }, { data: notifications }] =
    await Promise.all([
    admin
      .from("gym_class_schedules")
      .select("*")
      .eq("class_id", id)
      .order("sort_order", { ascending: true })
      .order("starts_at", { ascending: true }),
    admin.from("gym_class_applications").select("*").eq("class_id", id).order("created_at", { ascending: false }),
    admin.from("gym_class_reviews").select("*").eq("class_id", id).order("created_at", { ascending: false }).limit(50),
    admin.from("gym_class_reports").select("*").eq("class_id", id).order("created_at", { ascending: false }).limit(50),
    admin.from("gym_class_inquiries").select("*").eq("class_id", id).order("created_at", { ascending: false }).limit(50),
    admin.from("gym_class_waitlist").select("*").eq("class_id", id).order("created_at", { ascending: false }).limit(100),
    admin.from("gym_class_notifications").select("*").eq("class_id", id).order("created_at", { ascending: false }).limit(50),
  ]);

  const applicationStats = buildGymClassApplicationStats(applications ?? [], item);
  const visibleReviews = (reviews ?? []).filter((review) => review.status === "visible");
  const reviewAverage =
    visibleReviews.length > 0
      ? Math.round((visibleReviews.reduce((sum, review) => sum + Number(review.rating ?? 0), 0) / visibleReviews.length) * 10) / 10
      : null;

  return {
    error: null,
    item: {
      ...item,
      schedules: schedules ?? [],
      applications: applications ?? [],
      reviews: reviews ?? [],
      reports: reports ?? [],
      inquiries: inquiries ?? [],
      waitlist: waitlist ?? [],
      notifications: notifications ?? [],
      application_stats: applicationStats,
      review_stats: {
        count: visibleReviews.length,
        average: reviewAverage,
      },
      settlement_preview: {
        total_paid_krw: applicationStats.paidTotalKrw,
        refunded_krw: applicationStats.refundedTotalKrw,
        platform_fee_krw: applicationStats.platformFeeKrw,
        operator_amount_krw: applicationStats.operatorSettlementKrw,
      },
    },
  };
}

export async function GET(_req: Request, context: RouteContext) {
  const auth = await requireAdminRoute();
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  const detail = await getClassDetail(auth.admin, id);
  if (detail.error) {
    return NextResponse.json({ error: "운동 클래스를 찾지 못했습니다.", detail: detail.error }, { status: 404 });
  }
  return NextResponse.json({ item: detail.item });
}

export async function PATCH(req: Request, context: RouteContext) {
  const auth = await requireAdminRoute();
  if (!auth.ok) return auth.response;

  try {
    const { id } = await context.params;
    const body = asRecord(await req.json());
    const slug = normalizeSlug(body.slug);
    const updatePayload = buildUpdatePayload(body);
    await ensureClassCanOpen(auth.admin, updatePayload.operator_id, updatePayload.status);
    const payload = slug ? { ...updatePayload, slug } : updatePayload;

    const { error } = await auth.admin.from("gym_classes").update(payload).eq("id", id);
    if (error) {
      return NextResponse.json({ error: "운동 클래스 수정에 실패했습니다.", detail: error.message }, { status: 500 });
    }

    if (Array.isArray(body.schedules)) {
      const { error: deleteError } = await auth.admin.from("gym_class_schedules").delete().eq("class_id", id);
      if (deleteError) {
        return NextResponse.json({ error: "기존 일정 정리에 실패했습니다.", detail: deleteError.message }, { status: 500 });
      }

      const schedules = buildSchedulePayloads(id, body.schedules);
      if (schedules.length > 0) {
        const { error: insertError } = await auth.admin.from("gym_class_schedules").insert(schedules);
        if (insertError) {
          return NextResponse.json({ error: "일정 저장에 실패했습니다.", detail: insertError.message }, { status: 500 });
        }
      }
    }

    const detail = await getClassDetail(auth.admin, id);
    return NextResponse.json({ item: detail.item });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "운동 클래스 수정에 실패했습니다." },
      { status: 400 },
    );
  }
}

export async function DELETE(_req: Request, context: RouteContext) {
  const auth = await requireAdminRoute();
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  const { error } = await auth.admin.from("gym_classes").delete().eq("id", id);
  if (error) {
    return NextResponse.json({ error: "운동 클래스 삭제에 실패했습니다.", detail: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
