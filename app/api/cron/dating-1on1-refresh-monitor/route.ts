import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/server";
import { runRefreshMonitor } from "@/lib/dating-1on1-refresh-monitor";

export const maxDuration = 60;
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  const actual = Buffer.from(req.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret ?? ""}`);
  if (!secret || actual.length !== expected.length || !timingSafeEqual(actual, expected))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    return NextResponse.json(await runRefreshMonitor(createAdminClient()), { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Refresh audit unavailable" }, { status: 503 });
  }
}
