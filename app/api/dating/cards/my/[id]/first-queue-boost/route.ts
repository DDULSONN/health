import { NextResponse } from "next/server";
import { ensureAllowedMutationOrigin } from "@/lib/request-origin";
import { getRequestAuthContext } from "@/lib/supabase/request";
import { createAdminClient } from "@/lib/supabase/server";

const BOOST_AHEAD_COUNT = 30;

type AdminClient = ReturnType<typeof createAdminClient>;

function json(status: number, payload: Record<string, unknown>) {
  return NextResponse.json(payload, { status });
}

function isMissingQueueFeatureError(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const code = String((error as { code?: unknown }).code ?? "");
  const message = String((error as { message?: unknown }).message ?? "").toLowerCase();
  return (
    code === "42P01" ||
    code === "42703" ||
    code === "PGRST204" ||
    code === "PGRST205" ||
    message.includes("queue_priority_at") ||
    message.includes("dating_open_card_first_queue_boosts")
  );
}

async function moveCardAhead(admin: AdminClient, cardId: string, sex: "male" | "female") {
  const queueRes = await admin
    .from("dating_cards")
    .select("id")
    .eq("sex", sex)
    .eq("status", "pending")
    .order("queue_priority_at", { ascending: true })
    .order("created_at", { ascending: true })
    .order("id", { ascending: true })
    .limit(5000);

  if (queueRes.error) throw queueRes.error;

  const orderedIds = (queueRes.data ?? []).map((row) => String(row.id));
  const oldIndex = orderedIds.indexOf(cardId);
  if (oldIndex < 0) {
    return {
      oldPosition: null,
      newPosition: null,
      totalPending: orderedIds.length,
    };
  }

  const newIndex = Math.max(0, oldIndex - BOOST_AHEAD_COUNT);
  if (newIndex === oldIndex) {
    return {
      oldPosition: oldIndex + 1,
      newPosition: oldIndex + 1,
      totalPending: orderedIds.length,
    };
  }

  const reorderedIds = orderedIds.filter((id) => id !== cardId);
  reorderedIds.splice(newIndex, 0, cardId);

  const baseMs = Date.now();
  for (let index = 0; index < reorderedIds.length; index += 1) {
    const updateRes = await admin
      .from("dating_cards")
      .update({ queue_priority_at: new Date(baseMs + (index + 1) * 1000).toISOString() })
      .eq("id", reorderedIds[index]);

    if (updateRes.error) throw updateRes.error;
  }

  return {
    oldPosition: oldIndex + 1,
    newPosition: newIndex + 1,
    totalPending: orderedIds.length,
  };
}

export async function POST(req: Request, context: { params: Promise<{ id: string }> }) {
  const originResponse = ensureAllowedMutationOrigin(req);
  if (originResponse) return originResponse;

  const { user } = await getRequestAuthContext(req);
  if (!user) return json(401, { ok: false, error: "로그인이 필요합니다." });

  const { id } = await context.params;
  const cardId = typeof id === "string" ? id.trim() : "";
  if (!cardId) return json(400, { ok: false, error: "카드 ID가 필요합니다." });

  const admin = createAdminClient();
  const cardRes = await admin
    .from("dating_cards")
    .select("id,owner_user_id,sex,status")
    .eq("id", cardId)
    .maybeSingle();

  if (cardRes.error) {
    console.error("[POST /api/dating/cards/my/[id]/first-queue-boost] card lookup failed", cardRes.error);
    return json(500, { ok: false, error: "오픈카드 상태를 확인하지 못했습니다." });
  }
  if (!cardRes.data || cardRes.data.owner_user_id !== user.id) {
    return json(404, { ok: false, error: "오픈카드를 찾을 수 없습니다." });
  }
  if (cardRes.data.status !== "pending") {
    return json(409, { ok: false, error: "대기 중인 오픈카드만 순번을 앞당길 수 있습니다." });
  }
  if (cardRes.data.sex !== "male" && cardRes.data.sex !== "female") {
    return json(400, { ok: false, error: "오픈카드 성별 정보가 올바르지 않습니다." });
  }

  const countRes = await admin
    .from("dating_cards")
    .select("id", { count: "exact", head: true })
    .eq("owner_user_id", user.id);

  if (countRes.error) {
    console.error("[POST /api/dating/cards/my/[id]/first-queue-boost] card count failed", countRes.error);
    return json(500, { ok: false, error: "첫 오픈카드 여부를 확인하지 못했습니다." });
  }
  if ((countRes.count ?? 0) !== 1) {
    return json(409, { ok: false, error: "처음 작성한 오픈카드에서만 한 번 사용할 수 있습니다." });
  }

  const existingBoostRes = await admin
    .from("dating_open_card_first_queue_boosts")
    .select("user_id")
    .eq("user_id", user.id)
    .maybeSingle();

  if (existingBoostRes.error) {
    if (isMissingQueueFeatureError(existingBoostRes.error)) {
      return json(409, {
        ok: false,
        error: "첫 오픈카드 순번 앞당기기 SQL이 아직 적용되지 않았습니다.",
      });
    }
    console.error("[POST /api/dating/cards/my/[id]/first-queue-boost] boost lookup failed", existingBoostRes.error);
    return json(500, { ok: false, error: "사용 여부를 확인하지 못했습니다." });
  }
  if (existingBoostRes.data) {
    return json(409, { ok: false, error: "이미 첫 오픈카드 순번 앞당기기를 사용했습니다." });
  }

  try {
    const result = await moveCardAhead(admin, cardId, cardRes.data.sex);
    const insertRes = await admin.from("dating_open_card_first_queue_boosts").insert({
      user_id: user.id,
      card_id: cardId,
    });

    if (insertRes.error) throw insertRes.error;

    return json(200, {
      ok: true,
      result,
      message:
        result.oldPosition && result.newPosition && result.oldPosition !== result.newPosition
          ? `${result.oldPosition}번째에서 ${result.newPosition}번째로 앞당겼습니다.`
          : "이미 충분히 앞 순번입니다.",
    });
  } catch (error) {
    console.error("[POST /api/dating/cards/my/[id]/first-queue-boost] failed", error);
    if (String((error as { code?: unknown } | null)?.code ?? "") === "23505") {
      return json(409, { ok: false, error: "이미 첫 오픈카드 순번 앞당기기를 사용했습니다." });
    }
    if (isMissingQueueFeatureError(error)) {
      return json(409, {
        ok: false,
        error: "오픈카드 순번 앞당기기 SQL이 아직 적용되지 않았습니다.",
      });
    }
    return json(500, { ok: false, error: "순번을 앞당기지 못했습니다." });
  }
}
