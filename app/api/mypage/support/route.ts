import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { getRequestAuthContext } from "@/lib/supabase/request";

const ALLOWED_CATEGORIES = new Set(["payment", "dating", "abuse", "account", "technical", "other"]);

function json(status: number, payload: Record<string, unknown>) {
  return NextResponse.json(payload, { status });
}

export async function GET(req: Request) {
  const requestId = crypto.randomUUID();

  try {
    const { user } = await getRequestAuthContext(req);
    if (!user) {
      return json(401, { ok: false, requestId, error: "로그인이 필요합니다." });
    }

    const admin = createAdminClient();
    const res = await admin
      .from("support_inquiries")
      .select("id,category,subject,message,contact_email,contact_phone,status,admin_reply,created_at,answered_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(30);

    if (res.error) {
      console.error("[GET /api/mypage/support] failed", res.error);
      return json(500, { ok: false, requestId, error: "문의 내역을 불러오지 못했습니다." });
    }

    return json(200, { ok: true, requestId, items: res.data ?? [] });
  } catch (error) {
    console.error("[GET /api/mypage/support] unhandled", error);
    return json(500, { ok: false, requestId, error: "문의 내역을 불러오지 못했습니다." });
  }
}

export async function POST(req: Request) {
  const requestId = crypto.randomUUID();

  try {
    const { user } = await getRequestAuthContext(req);
    if (!user) {
      return json(401, { ok: false, requestId, error: "로그인이 필요합니다." });
    }

    const body = (await req.json().catch(() => null)) as
      | {
          category?: string;
          subject?: string;
          message?: string;
          contact_email?: string;
          contact_phone?: string;
        }
      | null;

    const category = String(body?.category ?? "").trim();
    const subject = String(body?.subject ?? "").trim().slice(0, 120);
    const message = String(body?.message ?? "").trim().slice(0, 4000);
    const contactEmail = String(body?.contact_email ?? user.email ?? "").trim().slice(0, 200);
    const contactPhone = String(body?.contact_phone ?? "").trim().slice(0, 30);

    if (!ALLOWED_CATEGORIES.has(category)) {
      return json(400, { ok: false, requestId, error: "문의 유형을 선택해 주세요." });
    }
    if (!subject) {
      return json(400, { ok: false, requestId, error: "문의 제목을 입력해 주세요." });
    }
    if (!message) {
      return json(400, { ok: false, requestId, error: "문의 내용을 입력해 주세요." });
    }

    const admin = createAdminClient();
    const insertRes = await admin
      .from("support_inquiries")
      .insert({
        user_id: user.id,
        category,
        subject,
        message,
        contact_email: contactEmail || null,
        contact_phone: contactPhone || null,
      })
      .select("id,category,subject,message,contact_email,contact_phone,status,admin_reply,created_at,answered_at")
      .single();

    if (insertRes.error) {
      console.error("[POST /api/mypage/support] failed", insertRes.error);
      return json(500, { ok: false, requestId, error: "문의 접수에 실패했습니다." });
    }

    return json(200, { ok: true, requestId, item: insertRes.data });
  } catch (error) {
    console.error("[POST /api/mypage/support] unhandled", error);
    return json(500, { ok: false, requestId, error: "문의 접수에 실패했습니다." });
  }
}
