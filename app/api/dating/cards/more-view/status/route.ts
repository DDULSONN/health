import { getMoreViewStatusBySex } from "@/lib/dating-more-view";
import { createAdminClient } from "@/lib/supabase/server";
import { getRequestAuthContext } from "@/lib/supabase/request";
import { NextResponse } from "next/server";

export async function GET(req: Request) {
  const requestId = crypto.randomUUID();

  try {
    const { user } = await getRequestAuthContext(req);
    if (!user) {
      return NextResponse.json({
        ok: true,
        requestId,
        loggedIn: false,
        male: "none",
        female: "none",
      });
    }

    const admin = createAdminClient();
    const statusMap = await getMoreViewStatusBySex(admin, user.id);

    return NextResponse.json({
      ok: true,
      requestId,
      loggedIn: true,
      male: statusMap.male,
      female: statusMap.female,
    });
  } catch (error) {
    console.error(`[more-view-status] ${requestId} unhandled`, error);
    return NextResponse.json(
      { ok: false, code: "INTERNAL_SERVER_ERROR", requestId, message: "서버 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}
