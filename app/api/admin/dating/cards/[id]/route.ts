import { isAdminEmail } from "@/lib/admin";
import { promotePendingCardsBySex } from "@/lib/dating-cards-queue";
import { OPEN_CARD_EXPIRE_HOURS, getOpenCardLimitBySex } from "@/lib/dating-open";
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

  if (!user || !isAdminEmail(user.email)) {
    return NextResponse.json({ error: "沅뚰븳???놁뒿?덈떎." }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const rawStatus = (body as { status?: string } | null)?.status;
  const status =
    rawStatus === "pending" || rawStatus === "public" || rawStatus === "hidden" || rawStatus === "expired"
      ? rawStatus
      : undefined;

  if (rawStatus != null && !status) {
    return NextResponse.json({ error: "?덉슜?섏? ?딆? ?곹깭媛믪엯?덈떎." }, { status: 400 });
  }

  const adminClient = createAdminClient();
  const { data: card, error: cardError } = await adminClient
    .from("dating_cards")
    .select(
      "id, sex, status, display_nickname, age, region, height_cm, job, training_years, strengths_text, ideal_type, instagram_id, total_3lift, percent_all"
    )
    .eq("id", id)
    .single();

  if (cardError || !card) {
    return NextResponse.json({ error: "移대뱶瑜?李얠쓣 ???놁뒿?덈떎." }, { status: 404 });
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
    return NextResponse.json({ error: "?섏젙??而⑤샽?댁? ?놁뒿?덈떎." }, { status: 400 });
  }

  if (contentUpdateRequested) {
    if (!displayNickname) {
      return NextResponse.json({ error: "?쒖떆???됰꽕?꾩쓣 ?낅젰?댁＜?몄슂." }, { status: 400 });
    }
    if (age != null && (age < 19 || age > 99)) {
      return NextResponse.json({ error: "?섏씠瑜??뺤씤?댁＜?몄슂." }, { status: 400 });
    }
    if (heightCm != null && (heightCm < 120 || heightCm > 230)) {
      return NextResponse.json({ error: "?ㅻ?瑜??뺤씤?댁＜?몄슂." }, { status: 400 });
    }
    if (trainingYears != null && (trainingYears < 0 || trainingYears > 50)) {
      return NextResponse.json({ error: "?대룞寃쎈젰???뺤씤?댁＜?몄슂." }, { status: 400 });
    }
    if (!instagramId || !validInstagramId(instagramId)) {
      return NextResponse.json(
        { error: "?몄뒪?洹몃옩 ?꾩씠???뺤떇???щ컮瑜댁? ?딆뒿?덈떎. (@ ?쒖쇅, ?곷Ц/?レ옄/._, 理쒕? 30??" },
        { status: 400 }
      );
    }
  }

  const updatePayload: {
    status?: "pending" | "public" | "hidden" | "expired";
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
    published_at?: string | null;
    expires_at?: string | null;
  } = {};

  if (contentUpdateRequested) {
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

  if (status === "public") {
    const slotLimit = getOpenCardLimitBySex(card.sex === "female" ? "female" : "male");

    let { count, error: slotError } = await adminClient
      .from("dating_cards")
      .select("id", { count: "exact", head: true })
      .eq("sex", card.sex)
      .eq("status", "public")
      .gt("expires_at", new Date().toISOString());

    // Legacy fallback when expires_at column is not available yet.
    if (slotError && isMissingColumnError(slotError)) {
      const legacy = await adminClient
        .from("dating_cards")
        .select("id", { count: "exact", head: true })
        .eq("sex", card.sex)
        .eq("status", "public");
      count = legacy.count;
      slotError = legacy.error;
    }

    if (slotError) {
      console.error("[PATCH /api/admin/dating/cards/[id]] slot count failed", slotError);
      return NextResponse.json({ error: "怨듦컻 ?щ’ ?뺤씤???ㅽ뙣?덉뒿?덈떎." }, { status: 500 });
    }

    if ((count ?? 0) >= slotLimit) {
      return NextResponse.json(
        { error: "?꾩옱 怨듦컻 ?щ’??媛??李쇱뼱?? ?湲곗뿴???깅줉?댁＜?몄슂.", code: "PUBLIC_SLOT_FULL" },
        { status: 409 }
      );
    }

    const now = new Date();
    updatePayload.published_at = now.toISOString();
    updatePayload.expires_at = new Date(now.getTime() + OPEN_CARD_EXPIRE_HOURS * 60 * 60 * 1000).toISOString();
  } else if (status === "pending") {
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
    updateRes = await adminClient.from("dating_cards").update(legacyPayload).eq("id", id);
  }

  if (updateRes.error) {
    console.error("[PATCH /api/admin/dating/cards/[id]] failed", updateRes.error);
    return NextResponse.json({ error: "?곹깭 蹂寃쎌뿉 ?ㅽ뙣?덉뒿?덈떎." }, { status: 500 });
  }

  if (status && ((card.status === "public" && status !== "public") || status === "hidden" || status === "expired")) {
    const sex = card.sex === "female" ? "female" : "male";
    try {
      await promotePendingCardsBySex(adminClient, sex);
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

  return NextResponse.json({ ok: true, status: status ?? card.status, item: updatedCard ?? null });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user || !isAdminEmail(user.email)) {
    return NextResponse.json({ error: "권한이 없습니다." }, { status: 403 });
  }

  const adminClient = createAdminClient();
  const { data: card, error: cardError } = await adminClient
    .from("dating_cards")
    .select("id, sex, status")
    .eq("id", id)
    .single();

  if (cardError || !card) {
    return NextResponse.json({ error: "카드를 찾을 수 없습니다." }, { status: 404 });
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
