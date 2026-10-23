import { NextResponse } from "next/server";
import { runAutomaticProfileReviews } from "@/lib/dating-auto-review-worker";

export const maxDuration = 60;
export async function GET(req: Request) {
  // Never trust a caller-supplied cron header to authorize reading private photos.
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    return NextResponse.json({ ok: true, ...await runAutomaticProfileReviews() });
  } catch {
    return NextResponse.json({ ok: false, error: "자동 검수 대기열을 처리하지 못했습니다." }, { status: 500 });
  }
}
