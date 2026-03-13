import { isAdminEmail } from "@/lib/admin";
import { approvePaidCard } from "@/lib/dating-purchase-fulfillment";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

type ApproveBody = {
  paidCardId?: unknown;
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
  console.log(`[dating-paid-approve] ${requestId} start`);

  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError) {
      console.error(`[dating-paid-approve] ${requestId} auth error`, authError);
      return json(401, { ok: false, code: "UNAUTHORIZED", requestId, message: "로그인이 필요합니다." });
    }
    if (!user) {
      return json(401, { ok: false, code: "UNAUTHORIZED", requestId, message: "로그인이 필요합니다." });
    }
    if (!isAllowedAdmin(user.id, user.email)) {
      return json(403, { ok: false, code: "FORBIDDEN", requestId, message: "권한이 없습니다." });
    }

    const body = ((await req.json().catch(() => null)) ?? {}) as ApproveBody;
    const paidCardId = typeof body.paidCardId === "string" ? body.paidCardId : "";
    if (!paidCardId) {
      return json(400, { ok: false, code: "VALIDATION_ERROR", requestId, message: "paidCardId가 필요합니다." });
    }

    const admin = createAdminClient();
    const approved = await approvePaidCard(admin, { paidCardId });

    if (!approved) {
      return json(404, { ok: false, code: "NOT_FOUND", requestId, message: "대상을 찾을 수 없거나 이미 처리되었습니다." });
    }

    return json(200, { ok: true, requestId, item: approved });
  } catch (error) {
    console.error(`[dating-paid-approve] ${requestId} unhandled`, error);
    return json(500, { ok: false, code: "INTERNAL_SERVER_ERROR", requestId, message: "서버 오류가 발생했습니다." });
  }
}
