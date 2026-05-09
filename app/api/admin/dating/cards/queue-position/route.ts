import { requireAdminRoute } from "@/lib/admin-route";
import { NextResponse } from "next/server";

function json(status: number, payload: Record<string, unknown>) {
  return NextResponse.json(payload, { status });
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

  const { data, error } = await auth.admin.rpc("admin_move_dating_card_queue_position", {
    p_card_id: cardId,
    p_target_position: Math.max(1, Math.floor(targetPosition)),
  });

  if (error) {
    const message = String(error.message ?? "");
    const code = String(error.code ?? "");
    console.error("[POST /api/admin/dating/cards/queue-position] failed", error);
    if (message.includes("CARD_NOT_FOUND")) return json(404, { ok: false, message: "오픈카드를 찾지 못했습니다." });
    if (message.includes("CARD_NOT_PENDING")) return json(409, { ok: false, message: "대기중인 오픈카드만 순번을 이동할 수 있습니다." });
    if (code === "PGRST202" || code === "42883" || message.includes("admin_move_dating_card_queue_position")) {
      return json(409, { ok: false, message: "대기 순번 이동 SQL이 아직 적용되지 않았습니다." });
    }
    return json(500, { ok: false, message: "대기 순번 이동에 실패했습니다." });
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
