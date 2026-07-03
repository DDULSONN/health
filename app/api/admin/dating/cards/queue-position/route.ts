import { requireAdminRoute } from "@/lib/admin-route";
import { NextResponse } from "next/server";

type AdminRouteAuth = Awaited<ReturnType<typeof requireAdminRoute>>;
type AdminClient = Extract<AdminRouteAuth, { ok: true }>["admin"];

type QueueRow = {
  id: string;
  queuePriorityAt: string;
};

function json(status: number, payload: Record<string, unknown>) {
  return NextResponse.json(payload, { status });
}

function isMissingQueueColumn(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const code = String((error as { code?: unknown }).code ?? "");
  const message = String((error as { message?: unknown }).message ?? "").toLowerCase();
  return code === "42703" || code === "PGRST204" || message.includes("queue_priority_at");
}

function pickPriorityBetween(before: QueueRow | null, after: QueueRow | null) {
  const beforeMs = before ? Date.parse(before.queuePriorityAt) : null;
  const afterMs = after ? Date.parse(after.queuePriorityAt) : null;

  if (beforeMs != null && afterMs != null && Number.isFinite(beforeMs) && Number.isFinite(afterMs) && afterMs - beforeMs > 2) {
    return beforeMs + Math.floor((afterMs - beforeMs) / 2);
  }
  if (beforeMs != null && Number.isFinite(beforeMs)) return beforeMs + 1;
  if (afterMs != null && Number.isFinite(afterMs)) return afterMs - 1;
  return Date.now();
}

async function moveQueuePositionDirect(admin: AdminClient, cardId: string, targetPosition: number) {
  const cardRes = await admin.from("dating_cards").select("id,sex,status").eq("id", cardId).maybeSingle();

  if (cardRes.error) throw cardRes.error;
  if (!cardRes.data) {
    return { status: 404, payload: { ok: false, message: "오픈카드를 찾지 못했습니다." } };
  }
  if (cardRes.data.status !== "pending") {
    return { status: 409, payload: { ok: false, message: "대기중인 오픈카드만 순번을 이동할 수 있습니다." } };
  }

  const queueRes = await admin
    .from("dating_cards")
    .select("id,queue_priority_at,created_at")
    .eq("sex", cardRes.data.sex)
    .eq("status", "pending")
    .order("queue_priority_at", { ascending: true })
    .order("created_at", { ascending: true })
    .order("id", { ascending: true })
    .limit(5000);

  if (queueRes.error) throw queueRes.error;

  const rows: QueueRow[] = (queueRes.data ?? []).map((row) => ({
    id: String(row.id),
    queuePriorityAt: String(row.queue_priority_at ?? row.created_at ?? new Date().toISOString()),
  }));
  const oldPosition = rows.findIndex((row) => row.id === cardId) + 1;
  if (oldPosition <= 0) {
    return { status: 409, payload: { ok: false, message: "대기열에서 해당 오픈카드를 찾지 못했습니다." } };
  }

  const rowsWithoutTarget = rows.filter((row) => row.id !== cardId);
  const newPosition = Math.min(Math.max(Math.floor(targetPosition), 1), rows.length);
  const newIndex = newPosition - 1;
  const before = newIndex > 0 ? rowsWithoutTarget[newIndex - 1] : null;
  const after = rowsWithoutTarget[newIndex] ?? null;
  const targetMs = pickPriorityBetween(before, after);

  const updateRes = await admin
    .from("dating_cards")
    .update({ queue_priority_at: new Date(targetMs).toISOString() })
    .eq("id", cardId)
    .eq("status", "pending");

  if (updateRes.error) throw updateRes.error;

  return {
    status: 200,
    payload: {
      ok: true,
      result: {
        card_id: cardId,
        sex: cardRes.data.sex,
        old_position: oldPosition,
        new_position: newPosition,
        total_pending: rows.length,
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
    return json(400, { ok: false, message: "카드 ID와 이동할 순번을 입력해 주세요." });
  }

  try {
    const result = await moveQueuePositionDirect(auth.admin, cardId, Math.max(1, Math.floor(targetPosition)));
    return json(result.status, result.payload);
  } catch (error) {
    console.error("[POST /api/admin/dating/cards/queue-position] failed", error);
    if (isMissingQueueColumn(error)) {
      return json(409, {
        ok: false,
        message: "대기 순번 이동 SQL이 아직 적용되지 않았습니다. supabase/sql/dating_cards_queue_priority.sql을 운영 DB에 적용해 주세요.",
      });
    }
    return json(500, { ok: false, message: "대기 순번 이동에 실패했습니다." });
  }
}
