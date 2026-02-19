import { isAdminEmail } from "@/lib/admin";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

type ApproveBody = {
  orderId?: unknown;
};

function json(status: number, payload: Record<string, unknown>) {
  return NextResponse.json(payload, { status });
}

function parseAdminUserIds() {
  return (process.env.ADMIN_USER_IDS ?? "")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
}

function isAllowedAdmin(userId: string, email?: string | null) {
  const allowlist = parseAdminUserIds();
  if (allowlist.length > 0) {
    return allowlist.includes(userId);
  }
  return isAdminEmail(email);
}

export async function POST(req: Request) {
  const requestId = crypto.randomUUID();

  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return json(401, { ok: false, code: "UNAUTHORIZED", requestId, message: "로그인이 필요합니다." });
    }
    if (!isAllowedAdmin(user.id, user.email)) {
      return json(403, { ok: false, code: "FORBIDDEN", requestId, message: "권한이 없습니다." });
    }

    const body = ((await req.json().catch(() => null)) ?? {}) as ApproveBody;
    const orderId = typeof body.orderId === "string" ? body.orderId : "";
    if (!orderId) {
      return json(400, { ok: false, code: "VALIDATION_ERROR", requestId, message: "orderId가 필요합니다." });
    }

    const admin = createAdminClient();
    const rpcRes = await admin.rpc("approve_apply_credit_order", {
      p_order_id: orderId,
      p_admin_user_id: user.id,
    });

    if (rpcRes.error) {
      console.error(`[admin-apply-credits-approve] ${requestId} rpc error`, rpcRes.error);
      return json(500, { ok: false, code: "APPROVE_FAILED", requestId, message: "승인 처리에 실패했습니다." });
    }

    const row = (Array.isArray(rpcRes.data) ? rpcRes.data[0] : null) as
      | {
          result_code?: string;
          order_id?: string;
          target_user_id?: string;
          added_credits?: number;
          credits_after?: number;
        }
      | null;

    const resultCode = row?.result_code ?? "";
    if (resultCode === "NOT_FOUND") {
      return json(404, { ok: false, code: "NOT_FOUND", requestId, message: "주문을 찾을 수 없습니다." });
    }
    if (resultCode === "NOT_PENDING") {
      return json(409, { ok: false, code: "NOT_PENDING", requestId, message: "pending 상태 주문만 승인할 수 있습니다." });
    }

    return json(200, {
      ok: true,
      code: "SUCCESS",
      requestId,
      orderId: row?.order_id ?? orderId,
      userId: row?.target_user_id ?? null,
      addedCredits: Number(row?.added_credits ?? 0),
      creditsAfter: Number(row?.credits_after ?? 0),
      alreadyApproved: resultCode === "ALREADY_APPROVED",
    });
  } catch (error) {
    console.error(`[admin-apply-credits-approve] ${requestId} unhandled`, error);
    return json(500, { ok: false, code: "INTERNAL_SERVER_ERROR", requestId, message: "서버 오류가 발생했습니다." });
  }
}
