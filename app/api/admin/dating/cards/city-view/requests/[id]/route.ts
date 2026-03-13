import { isAdminEmail } from "@/lib/admin";
import { approveCityViewRequest, rejectCityViewRequest } from "@/lib/dating-purchase-fulfillment";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

type Body = { status?: unknown; note?: unknown };

function parseAdminUserIds() {
  return (process.env.ADMIN_USER_IDS ?? "")
    .split(",")
    .map((v) => v.trim())
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
      return NextResponse.json({ ok: false, code: "UNAUTHORIZED", requestId, message: "로그인이 필요합니다." }, { status: 401 });
    }
    if (!isAllowedAdmin(user.id, user.email)) {
      return NextResponse.json({ ok: false, code: "FORBIDDEN", requestId, message: "권한이 없습니다." }, { status: 403 });
    }

    const { id } = await params;
    const body = ((await req.json().catch(() => null)) ?? {}) as Body;
    const status = body.status === "approved" || body.status === "rejected" ? body.status : null;
    const note = typeof body.note === "string" ? body.note.trim().slice(0, 500) : null;

    if (!status) {
      return NextResponse.json({ ok: false, message: "status 값이 올바르지 않습니다." }, { status: 400 });
    }

    const admin = createAdminClient();
    const item =
      status === "approved"
        ? await approveCityViewRequest(admin, {
            requestId: id,
            reviewedByUserId: user.id,
            note,
            accessHours: 3,
            bonusCredits: 1,
          })
        : await rejectCityViewRequest(admin, {
            requestId: id,
            reviewedByUserId: user.id,
            note,
          });

    if (!item) {
      return NextResponse.json({ ok: false, message: "대기중 요청만 처리할 수 있습니다." }, { status: 409 });
    }

    return NextResponse.json({ ok: true, item, requestId });
  } catch (error) {
    console.error(`[admin-city-view-patch] ${requestId} unhandled`, error);
    return NextResponse.json({ ok: false, message: "서버 오류가 발생했습니다.", requestId }, { status: 500 });
  }
}
