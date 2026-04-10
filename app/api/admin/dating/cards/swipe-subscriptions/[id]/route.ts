import { isAdminEmail } from "@/lib/admin";
import {
  approveSwipeSubscriptionRequest,
  rejectSwipeSubscriptionRequest,
} from "@/lib/dating-purchase-fulfillment";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

type Body = { status?: unknown; note?: unknown };

function parseAdminUserIds() {
  return (process.env.ADMIN_USER_IDS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

function isAllowedAdmin(userId: string, email?: string | null) {
  const allowlist = parseAdminUserIds();
  if (allowlist.length > 0) return allowlist.includes(userId);
  return isAdminEmail(email);
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const requestId = crypto.randomUUID();

  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ ok: false, requestId, message: "로그인이 필요합니다." }, { status: 401 });
    }
    if (!isAllowedAdmin(user.id, user.email)) {
      return NextResponse.json({ ok: false, requestId, message: "권한이 없습니다." }, { status: 403 });
    }

    const { id } = await params;
    const body = ((await req.json().catch(() => null)) ?? {}) as Body;
    const status = body.status === "approved" || body.status === "rejected" ? body.status : null;
    const note = typeof body.note === "string" ? body.note.trim().slice(0, 500) : null;

    if (!status) {
      return NextResponse.json({ ok: false, requestId, message: "status 값이 올바르지 않습니다." }, { status: 400 });
    }

    const admin = createAdminClient();
    const item =
      status === "approved"
        ? await approveSwipeSubscriptionRequest(admin, { requestId: id, reviewedByUserId: user.id, note })
        : await rejectSwipeSubscriptionRequest(admin, { requestId: id, reviewedByUserId: user.id, note });

    if (!item) {
      return NextResponse.json({ ok: false, requestId, message: "대기 중인 구매 신청만 처리할 수 있습니다." }, { status: 409 });
    }

    return NextResponse.json({ ok: true, requestId, item });
  } catch (error) {
    console.error("[admin-swipe-subscription-patch] unhandled", error);
    return NextResponse.json({ ok: false, requestId, message: "서버 오류가 발생했습니다." }, { status: 500 });
  }
}
