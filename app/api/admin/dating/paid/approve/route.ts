import { isAdminEmail } from "@/lib/admin";
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

    const now = new Date();
    const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const admin = createAdminClient();

    const updateRes = await admin
      .from("dating_paid_cards")
      .update({
        status: "approved",
        paid_at: now.toISOString(),
        expires_at: expiresAt.toISOString(),
      })
      .eq("id", paidCardId)
      .select("id")
      .single();

    if (updateRes.error) {
      const notFound = updateRes.error.code === "PGRST116";
      if (notFound) {
        return json(404, { ok: false, code: "NOT_FOUND", requestId, message: "대상을 찾을 수 없습니다." });
      }
      console.error(`[dating-paid-approve] ${requestId} update error`, updateRes.error);
      return json(500, { ok: false, code: "APPROVE_FAILED", requestId, message: "승인 처리에 실패했습니다." });
    }

    return json(200, { ok: true, requestId });
  } catch (error) {
    console.error(`[dating-paid-approve] ${requestId} unhandled`, error);
    return json(500, { ok: false, code: "INTERNAL_SERVER_ERROR", requestId, message: "서버 오류가 발생했습니다." });
  }
}
