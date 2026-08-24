import { isAllowedAdminUser } from "@/lib/admin";
import { promotePendingCardsBySex } from "@/lib/dating-cards-queue";
import { OPEN_CARD_EXPIRE_HOURS, getOpenCardLimitBySex } from "@/lib/dating-open";
import { invalidateDatingViewerSexResolution } from "@/lib/dating-viewer-sex";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

function isMissingColumnError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = String((error as { code?: unknown }).code ?? "");
  const message = String((error as { message?: unknown }).message ?? "").toLowerCase();
  return code === "42703" || code === "PGRST204" || message.includes("could not find") || message.includes("column");
}

function normalizeInstagramId(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.trim().replace(/^@+/, "").replace(/\s+/g, "");
}

function validInstagramId(value: string) {
  return /^[A-Za-z0-9._]{1,30}$/.test(value);
}

function toInt(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return Math.round(value);
  if (typeof value === "string") {
    const num = Number(value);
    if (Number.isFinite(num)) return Math.round(num);
  }
  return null;
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const num = Number(value);
    if (Number.isFinite(num)) return num;
  }
  return null;
}

function toText(value: unknown, max: number) {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, max);
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user || !isAllowedAdminUser(user.id, user.email)) {
    return NextResponse.json({ error: "권한이 없습니다." }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const expectedOwnerUserId = toText(
    (body as { expected_owner_user_id?: unknown } | null)?.expected_owner_user_id,
    100
  );
  const rawStatus = (body as { status?: string } | null)?.status;
  const rawSex = (body as { sex?: unknown } | null)?.sex;
  const sex = rawSex === "male" || rawSex === "female" ? rawSex : undefined;
  const status =
    rawStatus === "pending" || rawStatus === "public" || rawStatus === "hidden" || rawStatus === "expired"
      ? rawStatus
      : undefined;

  if (rawStatus != null && !status) {
    return NextResponse.json({ error: "허용되지 않은 상태값입니다." }, { status: 400 });
  }
  if (rawSex != null && !sex) {
    return NextResponse.json({ error: "성별은 남성 또는 여성만 선택할 수 있습니다." }, { status: 400 });
  }

  const adminClient = createAdminClient();
  const { data: card, error: cardError } = await adminClient
    .from("dating_cards")
    .select(
      "id, owner_user_id, sex, status, display_nickname, age, region, height_cm, job, training_years, strengths_text, ideal_type, instagram_id, total_3lift, percent_all, is_3lift_verified"
    )
    .eq("id", id)
    .single();

  if (cardError || !card) {
    return NextResponse.json({ error: "카드를 찾을 수 없습니다." }, { status: 404 });
  }
  if (expectedOwnerUserId && card.owner_user_id !== expectedOwnerUserId) {
    return NextResponse.json({ error: "선택한 회원의 오픈카드가 아닙니다." }, { status: 409 });
  }

  const displayNickname = toText((body as { display_nickname?: unknown } | null)?.display_nickname, 20);
  const age = toInt((body as { age?: unknown } | null)?.age);
  const region = toText((body as { region?: unknown } | null)?.region, 30);
  const heightCm = toInt((body as { height_cm?: unknown } | null)?.height_cm);
  const job = toText((body as { job?: unknown } | null)?.job, 50);
  const trainingYears = toInt((body as { training_years?: unknown } | null)?.training_years);
  const strengthsText = toText((body as { strengths_text?: unknown } | null)?.strengths_text, 150);
  const idealType = toText((body as { ideal_type?: unknown } | null)?.ideal_type, 1000);
  const instagramId = normalizeInstagramId((body as { instagram_id?: unknown } | null)?.instagram_id);
  const total3Lift = toInt((body as { total_3lift?: unknown } | null)?.total_3lift);
  const percentAll = toNumber((body as { percent_all?: unknown } | null)?.percent_all);

  const contentUpdateRequested =
    body != null &&
    [
      "display_nickname",
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
    ].some((key) => Object.prototype.hasOwnProperty.call(body, key));

  if (!status && !contentUpdateRequested) {
    return NextResponse.json({ error: "수정할 내용이 없습니다." }, { status: 400 });
  }

  if (contentUpdateRequested) {
    if (!displayNickname) {
      return NextResponse.json({ error: "표시 닉네임을 입력해주세요." }, { status: 400 });
    }
    if (age != null && (age < 19 || age > 99)) {
      return NextResponse.json({ error: "나이를 확인해주세요." }, { status: 400 });
    }
    if (heightCm != null && (heightCm < 120 || heightCm > 230)) {
      return NextResponse.json({ error: "키를 확인해주세요." }, { status: 400 });
    }
    if (trainingYears != null && (trainingYears < 0 || trainingYears > 50)) {
      return NextResponse.json({ error: "운동 경력을 확인해주세요." }, { status: 400 });
    }
    if (instagramId && !validInstagramId(instagramId)) {
      return NextResponse.json(
        { error: "인스타그램 아이디 형식이 올바르지 않습니다. (@ 제외, 영문/숫자/._, 최대 30자)" },
        { status: 400 }
      );
    }
  }

  const updatePayload: {
    status?: "pending" | "public" | "hidden" | "expired";
    sex?: "male" | "female";
    display_nickname?: string | null;
    age?: number | null;
    region?: string | null;
    height_cm?: number | null;
    job?: string | null;
    training_years?: number | null;
    strengths_text?: string | null;
    ideal_type?: string | null;
    instagram_id?: string | null;
    total_3lift?: number | null;
    percent_all?: number | null;
    is_3lift_verified?: boolean;
    published_at?: string | null;
    expires_at?: string | null;
    queue_priority_at?: string | null;
  } = {};

  if (contentUpdateRequested) {
    if (sex) updatePayload.sex = sex;
    updatePayload.display_nickname = displayNickname;
    updatePayload.age = age;
    updatePayload.region = region || null;
    updatePayload.height_cm = heightCm;
    updatePayload.job = job || null;
    updatePayload.training_years = trainingYears;
    updatePayload.strengths_text = strengthsText || null;
    updatePayload.ideal_type = idealType || null;
    updatePayload.instagram_id = instagramId;
    updatePayload.total_3lift = total3Lift;
    updatePayload.percent_all = percentAll;
  }

  if (status) {
    updatePayload.status = status;
  }

  const effectiveSex = sex ?? (card.sex === "female" ? "female" : "male");
  const sexChanged = Boolean(sex && sex !== card.sex);
  const shouldCheckPublicSlot = status === "public" || (sexChanged && card.status === "public");
  let queuedDueToSexChange = false;

  if (shouldCheckPublicSlot) {
    const slotLimit = getOpenCardLimitBySex(effectiveSex);

    let { count, error: slotError } = await adminClient
      .from("dating_cards")
      .select("id", { count: "exact", head: true })
      .eq("sex", effectiveSex)
      .eq("status", "public")
      .neq("id", id)
      .gt("expires_at", new Date().toISOString());

    // Legacy fallback when expires_at column is not available yet.
    if (slotError && isMissingColumnError(slotError)) {
      const legacy = await adminClient
        .from("dating_cards")
        .select("id", { count: "exact", head: true })
        .eq("sex", effectiveSex)
        .eq("status", "public")
        .neq("id", id);
      count = legacy.count;
      slotError = legacy.error;
    }

    if (slotError) {
      console.error("[PATCH /api/admin/dating/cards/[id]] slot count failed", slotError);
      return NextResponse.json({ error: "공개 슬롯 확인에 실패했습니다." }, { status: 500 });
    }

    if ((count ?? 0) >= slotLimit) {
      if (sexChanged && card.status === "public" && status == null) {
        queuedDueToSexChange = true;
        updatePayload.status = "pending";
        updatePayload.published_at = null;
        updatePayload.expires_at = null;
        updatePayload.queue_priority_at = new Date().toISOString();
      } else {
        return NextResponse.json(
          {
            error: "현재 공개 슬롯이 가득 찼습니다. 먼저 기존 공개 카드를 대기 또는 숨김 상태로 변경해주세요.",
            code: "PUBLIC_SLOT_FULL",
          },
          { status: 409 }
        );
      }
    }

    if (status === "public") {
      const now = new Date();
      updatePayload.published_at = now.toISOString();
      updatePayload.expires_at = new Date(now.getTime() + OPEN_CARD_EXPIRE_HOURS * 60 * 60 * 1000).toISOString();

      if (card.owner_user_id) {
        const certRes = await adminClient
        .from("cert_requests")
        .select("id,total")
        .eq("user_id", card.owner_user_id)
        .eq("status", "approved")
        .order("reviewed_at", { ascending: false, nullsFirst: false })
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

        if (certRes.error) {
          console.warn("[PATCH /api/admin/dating/cards/[id]] cert sync skipped", certRes.error);
        } else {
          const verifiedTotal3Lift = toInt((certRes.data as { total?: unknown } | null)?.total);
          updatePayload.is_3lift_verified = Boolean(certRes.data);
          if (verifiedTotal3Lift != null) {
            updatePayload.total_3lift = verifiedTotal3Lift;
          }
        }
      }
    }
  }

  if (status === "pending") {
    updatePayload.published_at = null;
    updatePayload.expires_at = null;
  } else if (status === "hidden" || status === "expired") {
    updatePayload.expires_at = new Date().toISOString();
  }

  let updateRes = await adminClient.from("dating_cards").update(updatePayload).eq("id", id);
  if (updateRes.error && isMissingColumnError(updateRes.error)) {
    // Legacy fallback when published_at / expires_at columns are absent.
    const legacyPayload = status ? { ...updatePayload, status } : updatePayload;
    delete legacyPayload.published_at;
    delete legacyPayload.expires_at;
    delete legacyPayload.queue_priority_at;
    updateRes = await adminClient.from("dating_cards").update(legacyPayload).eq("id", id);
  }

  if (updateRes.error) {
    console.error("[PATCH /api/admin/dating/cards/[id]] failed", updateRes.error);
    return NextResponse.json({ error: "카드 수정에 실패했습니다." }, { status: 500 });
  }

  if (sexChanged) {
    invalidateDatingViewerSexResolution(card.owner_user_id);
  }

  const previousSexNeedsPromotion =
    card.status === "public" && (sexChanged || (status != null && status !== "public"));
  if (previousSexNeedsPromotion) {
    const previousSex = card.sex === "female" ? "female" : "male";
    try {
      await promotePendingCardsBySex(adminClient, previousSex);
    } catch (promoteError) {
      console.error("[PATCH /api/admin/dating/cards/[id]] promote pending failed", promoteError);
    }
  }

  const { data: updatedCard } = await adminClient
    .from("dating_cards")
    .select(
      "id, owner_user_id, sex, display_nickname, age, region, height_cm, job, training_years, strengths_text, ideal_type, instagram_id, total_3lift, percent_all, is_3lift_verified, photo_paths, blur_thumb_path, status, published_at, expires_at, created_at"
    )
    .eq("id", id)
    .maybeSingle();

  return NextResponse.json({
    ok: true,
    status: updatedCard?.status ?? updatePayload.status ?? status ?? card.status,
    item: updatedCard ?? null,
    queuedDueToSexChange,
  });
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user || !isAllowedAdminUser(user.id, user.email)) {
    return NextResponse.json({ error: "권한이 없습니다." }, { status: 403 });
  }

  const adminClient = createAdminClient();
  const expectedOwnerUserId = toText(new URL(req.url).searchParams.get("userId"), 100);
  const { data: card, error: cardError } = await adminClient
    .from("dating_cards")
    .select("id, owner_user_id, sex, status")
    .eq("id", id)
    .single();

  if (cardError || !card) {
    return NextResponse.json({ error: "카드를 찾을 수 없습니다." }, { status: 404 });
  }
  if (expectedOwnerUserId && card.owner_user_id !== expectedOwnerUserId) {
    return NextResponse.json({ error: "선택한 회원의 오픈카드가 아닙니다." }, { status: 409 });
  }

  const { error: deleteError } = await adminClient.from("dating_cards").delete().eq("id", id);
  if (deleteError) {
    console.error("[DELETE /api/admin/dating/cards/[id]] failed", deleteError);
    return NextResponse.json({ error: "카드 삭제에 실패했습니다." }, { status: 500 });
  }

  if (card.status === "public") {
    const sex = card.sex === "female" ? "female" : "male";
    try {
      await promotePendingCardsBySex(adminClient, sex);
    } catch (promoteError) {
      console.error("[DELETE /api/admin/dating/cards/[id]] promote pending failed", promoteError);
    }
  }

  return NextResponse.json({ ok: true, deleted: true, id });
}
