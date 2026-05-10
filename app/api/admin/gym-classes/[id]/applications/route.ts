import { NextResponse } from "next/server";
import { requireAdminRoute } from "@/lib/admin-route";
import { GYM_CLASS_ACTIVE_APPLICATION_STATUSES, normalizeGymClassGender } from "@/lib/gym-class-rules";

const CLASS_APPLICATION_TERMS_VERSION = "gym_class_application_terms_v1";

type RouteContext = {
  params: Promise<{ id: string }>;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function cleanText(value: unknown, maxLength = 500) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, maxLength) : null;
}

function cleanInteger(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

function requiredText(value: unknown, label: string, maxLength = 120) {
  const cleaned = cleanText(value, maxLength);
  if (!cleaned) throw new Error(`${label}을 입력해주세요.`);
  return cleaned;
}

function getClientIp(req: Request) {
  const forwarded = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || req.headers.get("x-real-ip") || null;
}

function ensureApplicationTermsAccepted(body: Record<string, unknown>) {
  if (body.privacy_accepted !== true || body.broker_notice_accepted !== true) {
    throw new Error("개인정보 제공 및 중개 안내에 동의해주세요.");
  }
  if (body.refund_policy_accepted === false) {
    throw new Error("환불 규정을 확인해주세요.");
  }
}

export async function GET(_req: Request, context: RouteContext) {
  const auth = await requireAdminRoute();
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  const { data, error } = await auth.admin
    .from("gym_class_applications")
    .select("*")
    .eq("class_id", id)
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: "지원자 목록을 불러오지 못했습니다.", detail: error.message }, { status: 500 });
  }

  return NextResponse.json({ items: data ?? [] });
}

export async function POST(req: Request, context: RouteContext) {
  const auth = await requireAdminRoute();
  if (!auth.ok) return auth.response;

  try {
    const { id } = await context.params;
    const body = asRecord(await req.json());
    ensureApplicationTermsAccepted(body);
    const scheduleId = cleanText(body.schedule_id, 80);
    const gender = normalizeGymClassGender(body.gender);
    const now = new Date().toISOString();

    const { data: gymClass, error: classError } = await auth.admin
      .from("gym_classes")
      .select("id,status,capacity,male_capacity,female_capacity,application_deadline,photo_consent_required")
      .eq("id", id)
      .single();

    if (classError || !gymClass) {
      return NextResponse.json({ error: "클래스를 찾지 못했습니다.", detail: classError?.message }, { status: 404 });
    }

    if (gymClass.status !== "published") {
      return NextResponse.json({ error: "모집 중인 클래스만 신청할 수 있습니다." }, { status: 400 });
    }

    if (gymClass.photo_consent_required && body.photo_consent_accepted !== true) {
      return NextResponse.json({ error: "사진/영상 촬영 안내를 확인해주세요." }, { status: 400 });
    }

    if (gymClass.application_deadline && new Date(gymClass.application_deadline).getTime() < Date.now()) {
      return NextResponse.json({ error: "신청 마감 시간이 지난 클래스입니다." }, { status: 400 });
    }

    const activeStatuses = [...GYM_CLASS_ACTIVE_APPLICATION_STATUSES];

    if (gender === "male" && gymClass.male_capacity !== null) {
      const { count, error: countError } = await auth.admin
        .from("gym_class_applications")
        .select("id", { count: "exact", head: true })
        .eq("class_id", id)
        .eq("gender", "male")
        .in("status", activeStatuses);

      if (countError) return NextResponse.json({ error: "남성 정원 확인에 실패했습니다.", detail: countError.message }, { status: 500 });
      if ((count ?? 0) >= gymClass.male_capacity) {
        return NextResponse.json({ error: "남성 정원이 마감되었습니다. 대기자 등록을 이용해주세요." }, { status: 400 });
      }
    }

    if (gender === "female" && gymClass.female_capacity !== null) {
      const { count, error: countError } = await auth.admin
        .from("gym_class_applications")
        .select("id", { count: "exact", head: true })
        .eq("class_id", id)
        .eq("gender", "female")
        .in("status", activeStatuses);

      if (countError) return NextResponse.json({ error: "여성 정원 확인에 실패했습니다.", detail: countError.message }, { status: 500 });
      if ((count ?? 0) >= gymClass.female_capacity) {
        return NextResponse.json({ error: "여성 정원이 마감되었습니다. 대기자 등록을 이용해주세요." }, { status: 400 });
      }
    }

    if (scheduleId) {
      const { data: schedule, error: scheduleError } = await auth.admin
        .from("gym_class_schedules")
        .select("id,capacity")
        .eq("id", scheduleId)
        .eq("class_id", id)
        .single();

      if (scheduleError || !schedule) {
        return NextResponse.json({ error: "선택한 일정을 찾지 못했습니다.", detail: scheduleError?.message }, { status: 404 });
      }

      if (schedule.capacity) {
        const { count, error: countError } = await auth.admin
          .from("gym_class_applications")
          .select("id", { count: "exact", head: true })
          .eq("schedule_id", scheduleId)
          .in("status", activeStatuses);

        if (countError) return NextResponse.json({ error: "정원 확인에 실패했습니다.", detail: countError.message }, { status: 500 });
        if ((count ?? 0) >= schedule.capacity) {
          return NextResponse.json({ error: "선택한 일정의 정원이 마감되었습니다. 대기자 등록을 이용해주세요." }, { status: 400 });
        }
      }
    } else if (gymClass.capacity) {
      const { count, error: countError } = await auth.admin
        .from("gym_class_applications")
        .select("id", { count: "exact", head: true })
        .eq("class_id", id)
        .in("status", activeStatuses);

      if (countError) return NextResponse.json({ error: "정원 확인에 실패했습니다.", detail: countError.message }, { status: 500 });
      if ((count ?? 0) >= gymClass.capacity) {
        return NextResponse.json({ error: "클래스 정원이 마감되었습니다. 대기자 등록을 이용해주세요." }, { status: 400 });
      }
    }

    const paymentStatus = body.payment_status === "paid" || body.payment_status === "manual_paid" ? body.payment_status : "unpaid";
    const payload = {
      class_id: id,
      schedule_id: scheduleId,
      name: requiredText(body.name, "이름", 80),
      phone: cleanText(body.phone, 40),
      email: cleanText(body.email, 160),
      gender,
      memo: cleanText(body.memo, 1000),
      status: "submitted",
      payment_status: paymentStatus,
      paid_amount_krw: cleanInteger(body.paid_amount_krw),
      paid_at: paymentStatus === "paid" || paymentStatus === "manual_paid" ? now : null,
      admin_note: cleanText(body.admin_note, 1000),
      terms_version: CLASS_APPLICATION_TERMS_VERSION,
      privacy_accepted_at: now,
      broker_notice_accepted_at: now,
      accepted_ip: getClientIp(req),
      accepted_user_agent: cleanText(req.headers.get("user-agent"), 500),
      terms_payload: {
        privacy_accepted: true,
        broker_notice_accepted: true,
        refund_policy_accepted: body.refund_policy_accepted !== false,
        photo_consent_accepted: body.photo_consent_accepted === true,
        version: CLASS_APPLICATION_TERMS_VERSION,
      },
      updated_at: now,
    };

    const { data, error } = await auth.admin.from("gym_class_applications").insert(payload).select("*").single();
    if (error) {
      return NextResponse.json({ error: "지원자 저장에 실패했습니다.", detail: error.message }, { status: 500 });
    }

    await auth.admin.from("gym_class_notifications").insert({
      class_id: id,
      application_id: data.id,
      email: data.email,
      phone: data.phone,
      kind: "application_submitted",
      title: "클래스 신청이 접수되었습니다.",
      body: "관리자가 신청 내용을 확인한 뒤 확정 여부를 안내합니다.",
      status: data.email || data.phone ? "queued" : "skipped",
    });

    return NextResponse.json({ item: data });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "지원자 저장에 실패했습니다." }, { status: 400 });
  }
}
