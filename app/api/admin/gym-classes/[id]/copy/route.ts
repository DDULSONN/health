import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireAdminRoute } from "@/lib/admin-route";

type RouteContext = {
  params: Promise<{ id: string }>;
};

function copyText(value: unknown, maxLength = 80) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, maxLength) : null;
}

async function buildUniqueSlug(admin: SupabaseClient, baseSlug: string) {
  const base = `${baseSlug || "class"}-copy`.replace(/-+/g, "-").replace(/^-|-$/g, "");
  for (let index = 0; index < 30; index += 1) {
    const candidate = index === 0 ? base : `${base}-${index + 1}`;
    const { data, error } = await admin.from("gym_classes").select("id").eq("slug", candidate).maybeSingle();
    if (error && !String(error.message).includes("multiple")) throw error;
    if (!data) return candidate;
  }
  return `${base}-${Date.now().toString(36)}`;
}

export async function POST(_req: Request, context: RouteContext) {
  const auth = await requireAdminRoute();
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  const { data: source, error: sourceError } = await auth.admin.from("gym_classes").select("*").eq("id", id).single();
  if (sourceError || !source) {
    return NextResponse.json({ error: "복사할 클래스를 찾지 못했습니다.", detail: sourceError?.message }, { status: 404 });
  }

  const slug = await buildUniqueSlug(auth.admin, copyText(source.slug) ?? "class");
  const { id: _id, created_at: _createdAt, updated_at: _updatedAt, auto_closed_at: _autoClosedAt, settled_at: _settledAt, ...rest } = source;
  const payload = {
    ...rest,
    slug,
    title: `${source.title} 복사본`,
    status: "draft",
    settlement_status: "unsettled",
    settlement_total_paid_krw: 0,
    settlement_platform_fee_krw: 0,
    settlement_operator_amount_krw: 0,
    settled_at: null,
    auto_closed_at: null,
    created_by_user_id: auth.user.id,
    updated_at: new Date().toISOString(),
  };

  const { data: copied, error: copyError } = await auth.admin.from("gym_classes").insert(payload).select("*").single();
  if (copyError || !copied) {
    return NextResponse.json({ error: "클래스 복사에 실패했습니다.", detail: copyError?.message }, { status: 500 });
  }

  const { data: schedules } = await auth.admin
    .from("gym_class_schedules")
    .select("label,starts_at,ends_at,capacity,sort_order")
    .eq("class_id", id)
    .order("sort_order", { ascending: true });

  const copiedSchedules = (schedules ?? []).map((schedule) => ({
    ...schedule,
    class_id: copied.id,
  }));
  if (copiedSchedules.length > 0) {
    const { error: scheduleError } = await auth.admin.from("gym_class_schedules").insert(copiedSchedules);
    if (scheduleError) {
      return NextResponse.json({ error: "클래스는 복사했지만 일정 복사에 실패했습니다.", detail: scheduleError.message }, { status: 500 });
    }
  }

  return NextResponse.json({ item: copied });
}
