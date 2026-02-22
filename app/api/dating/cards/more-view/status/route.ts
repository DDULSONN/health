import { getMoreViewStatusBySex } from "@/lib/dating-more-view";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function GET() {
  const requestId = crypto.randomUUID();

  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
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
