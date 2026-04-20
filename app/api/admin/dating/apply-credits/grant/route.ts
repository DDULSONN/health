import { isAdminEmail } from "@/lib/admin";
import { grantApplyCredits } from "@/lib/dating-purchase-fulfillment";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

type GrantBody = {
  nickname?: unknown;
  credits?: unknown;
};

function json(status: number, payload: Record<string, unknown>) {
  return NextResponse.json(payload, { status });
}

function parseAdminUserIds() {
  return (process.env.ADMIN_USER_IDS ?? "")
    .split(",")
    .map((value) => value.trim())
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

    const body = ((await req.json().catch(() => null)) ?? {}) as GrantBody;
    const nickname = typeof body.nickname === "string" ? body.nickname.trim() : "";
    const credits = Math.max(1, Math.min(20, Number(body.credits ?? 3) || 3));

    if (!nickname) {
      return json(400, {
        ok: false,
        code: "VALIDATION_ERROR",
        requestId,
        message: "닉네임을 입력해 주세요.",
      });
    }

    const admin = createAdminClient();
    const profilesRes = await admin
      .from("profiles")
      .select("user_id,nickname")
      .eq("nickname", nickname)
      .limit(5);

    if (profilesRes.error) {
      console.error(`[admin-apply-credits-grant] ${requestId} profiles query error`, profilesRes.error);
      return json(500, {
        ok: false,
        code: "LOOKUP_FAILED",
        requestId,
        message: "닉네임 조회에 실패했습니다.",
      });
    }

    const profiles = profilesRes.data ?? [];
    if (profiles.length === 0) {
      return json(404, {
        ok: false,
        code: "NOT_FOUND",
        requestId,
        message: "해당 닉네임 사용자를 찾지 못했습니다.",
      });
    }

    if (profiles.length > 1) {
      return json(409, {
        ok: false,
        code: "DUPLICATE_NICKNAME",
        requestId,
        message: "같은 닉네임 사용자가 여러 명 있습니다. 다른 방법으로 확인해 주세요.",
      });
    }

    const targetUserId = profiles[0].user_id;
    const grantRes = await grantApplyCredits(admin, targetUserId, credits);
    const orderInsertRes = await admin
      .from("apply_credit_orders")
      .insert({
        user_id: targetUserId,
        pack_size: credits,
        amount: 0,
        status: "approved",
        processed_at: new Date().toISOString(),
        memo: `admin_direct_grant nickname=${nickname} granted_by=${user.id}`,
      })
      .select("id")
      .single();

    if (orderInsertRes.error) {
      console.error(`[admin-apply-credits-grant] ${requestId} order insert error`, orderInsertRes.error);
      return json(500, {
        ok: false,
        code: "ORDER_LOG_FAILED",
        requestId,
        message: "지원권은 지급했지만 이력 저장에 실패했습니다. 확인이 필요합니다.",
      });
    }

    return json(200, {
      ok: true,
      requestId,
      nickname,
      userId: targetUserId,
      addedCredits: grantRes.addedCredits,
      creditsAfter: grantRes.creditsAfter,
      orderId: orderInsertRes.data.id,
    });
  } catch (error) {
    console.error(`[admin-apply-credits-grant] ${requestId} unhandled`, error);
    return json(500, {
      ok: false,
      code: "INTERNAL_SERVER_ERROR",
      requestId,
      message: "서버 오류가 발생했습니다.",
    });
  }
}
