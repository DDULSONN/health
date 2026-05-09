import { requireAdminRoute } from "@/lib/admin-route";
import { NextResponse } from "next/server";

type AdminRouteAuth = Awaited<ReturnType<typeof requireAdminRoute>>;
type AdminClient = Extract<AdminRouteAuth, { ok: true }>["admin"];

function json(status: number, payload: Record<string, unknown>) {
  return NextResponse.json(payload, { status });
}

function isMissingQueueSql(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const code = String((error as { code?: unknown }).code ?? "");
  const message = String((error as { message?: unknown }).message ?? "").toLowerCase();
  return (
    code === "42703" ||
    code === "PGRST204" ||
    code === "PGRST202" ||
    code === "42883" ||
    message.includes("queue_priority_at") ||
    message.includes("admin_move_dating_card_queue_position")
  );
}

async function moveQueuePositionDirect(admin: AdminClient, cardId: string, targetPosition: number) {
  const cardRes = await admin
    .from("dating_cards")
    .select("id,sex,status")
    .eq("id", cardId)
    .maybeSingle();

  if (cardRes.error) throw cardRes.error;
  if (!cardRes.data) {
    return { status: 404, payload: { ok: false, message: "오픈카드를 찾지 못했습니다." } };
  }
  if (cardRes.data.status !== "pending") {
    return { status: 409, payload: { ok: false, message: "대기중인 오픈카드만 순번을 이동할 수 있습니다." } };
  }

  const queueRes = await admin
    .from("dating_cards")
    .select("id")
    .eq("sex", cardRes.data.sex)
    .eq("status", "pending")
    .order("queue_priority_at", { ascending: true })
    .order("created_at", { ascending: true })
    .order("id", { ascending: true })
    .limit(5000);

  if (queueRes.error) throw queueRes.error;

  const orderedIds = (queueRes.data ?? []).map((row) => String(row.id));
  const oldPosition = orderedIds.indexOf(cardId) + 1;
  if (oldPosition <= 0) {
    return { status: 409, payload: { ok: false, message: "대기열에서 해당 오픈카드를 찾지 못했습니다." } };
  }

  const reorderedIds = orderedIds.filter((id) => id !== cardId);
  const newPosition = Math.min(Math.max(Math.floor(targetPosition), 1), orderedIds.length);
  reorderedIds.splice(newPosition - 1, 0, cardId);

  const baseMs = Date.now();
  for (let index = 0; index < reorderedIds.length; index += 1) {
    const updateRes = await admin
      .from("dating_cards")
      .update({ queue_priority_at: new Date(baseMs + (index + 1) * 1000).toISOString() })
      .eq("id", reorderedIds[index]);

    if (updateRes.error) throw updateRes.error;
  }

  return {
    status: 200,
    payload: {
      ok: true,
      result: {
        card_id: cardId,
        sex: cardRes.data.sex,
        old_position: oldPosition,
        new_position: newPosition,
        total_pending: orderedIds.length,
      },
      message: `${oldPosition}번에서 ${newPosition}번으로 이동했습니다.`,
    },
  };
}

export async function POST(req: Request) {
  const auth = await requireAdminRoute();
  if (!auth.ok) return auth.response;

  const body = (await req.json().catch(() => null)) as {
    cardId?: unknown;
    targetPosition?: unknown;
  } | null;

  const cardId = typeof body?.cardId === "string" ? body.cardId.trim() : "";
  const targetPosition = Number(body?.targetPosition);

  if (!cardId || !Number.isFinite(targetPosition)) {
    return json(400, { ok: false, message: "카드 ID와 이동할 순번을 입력해주세요." });
  }

  const normalizedTargetPosition = Math.max(1, Math.floor(targetPosition));
  const { data, error } = await auth.admin.rpc("admin_move_dating_card_queue_position", {
    p_card_id: cardId,
    p_target_position: normalizedTargetPosition,
  });

  if (error) {
    const message = String(error.message ?? "");
    const code = String(error.code ?? "");
    console.error("[POST /api/admin/dating/cards/queue-position] rpc failed", error);

    if (message.includes("CARD_NOT_FOUND")) return json(404, { ok: false, message: "오픈카드를 찾지 못했습니다." });
    if (message.includes("CARD_NOT_PENDING")) return json(409, { ok: false, message: "대기중인 오픈카드만 순번을 이동할 수 있습니다." });

    try {
      const fallback = await moveQueuePositionDirect(auth.admin, cardId, normalizedTargetPosition);
      return json(fallback.status, fallback.payload);
    } catch (fallbackError) {
      console.error("[POST /api/admin/dating/cards/queue-position] direct fallback failed", fallbackError);
      if (isMissingQueueSql(error) || isMissingQueueSql(fallbackError)) {
        return json(409, {
          ok: false,
          message: "대기 순번 이동 SQL이 아직 적용되지 않았습니다. supabase/sql/dating_cards_queue_priority.sql을 운영 DB에 적용해주세요.",
        });
      }
      return json(500, {
        ok: false,
        message: `대기 순번 이동에 실패했습니다. ${code || "DB"} ${message || ""}`.trim(),
      });
    }
  }

  const row = Array.isArray(data) ? data[0] : null;
  return json(200, {
    ok: true,
    result: row,
    message: row
      ? `${Number(row.old_position ?? 0)}번에서 ${Number(row.new_position ?? 0)}번으로 이동했습니다.`
      : "대기 순번을 이동했습니다.",
  });
}
