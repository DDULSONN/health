import { NextResponse } from "next/server";

import { ensureCronAuthorized } from "@/lib/cron-auth";
import { isNicknameReviewTableMissing, scanNicknameReviews } from "@/lib/nickname-review";
import { createAdminClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  const unauthorized = ensureCronAuthorized(request);
  if (unauthorized) return unauthorized;

  try {
    const result = await scanNicknameReviews(createAdminClient());
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error("[cron/nickname-review] scan failed", error);
    if (isNicknameReviewTableMissing(error)) {
      return NextResponse.json(
        { error: "닉네임 검수 SQL을 먼저 적용해 주세요.", code: "NICKNAME_REVIEW_TABLE_MISSING" },
        { status: 503 }
      );
    }
    return NextResponse.json({ error: "닉네임 자동 검수에 실패했습니다." }, { status: 500 });
  }
}
