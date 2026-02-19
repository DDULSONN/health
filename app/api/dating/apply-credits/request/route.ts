import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

const PACK_SIZE = 3;
const PACK_AMOUNT = 5000;

function json(status: number, payload: Record<string, unknown>) {
  return NextResponse.json(payload, { status });
}

export async function POST() {
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

    const insertRes = await supabase
      .from("apply_credit_orders")
      .insert({
        user_id: user.id,
        pack_size: PACK_SIZE,
        amount: PACK_AMOUNT,
        status: "pending",
      })
      .select("id, pack_size, amount")
      .single();

    if (insertRes.error || !insertRes.data) {
      console.error(`[apply-credits-request] ${requestId} insert error`, insertRes.error);
      return json(500, {
        ok: false,
        code: "CREATE_ORDER_FAILED",
        requestId,
        message: "지원권 신청 생성에 실패했습니다.",
      });
    }

    return json(200, {
      ok: true,
      code: "SUCCESS",
      requestId,
      orderId: insertRes.data.id,
      packSize: insertRes.data.pack_size,
      amount: insertRes.data.amount,
      message: "신청이 접수되었습니다. 오픈카톡으로 닉네임+신청ID를 보내주세요.",
    });
  } catch (error) {
    console.error(`[apply-credits-request] ${requestId} unhandled`, error);
    return json(500, { ok: false, code: "INTERNAL_SERVER_ERROR", requestId, message: "서버 오류가 발생했습니다." });
  }
}
