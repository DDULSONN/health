import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { isWinterExpansionEnabled } from "@/lib/dating-1on1-expansion";
import { readOneOnOneWinterAvailability } from "@/lib/dating-1on1-winter-expansion";
import { createAdminClient } from "@/lib/supabase/server";
import { getKstDateString } from "@/lib/weekly";

export const maxDuration = 60;
type Alert = { user_id: string; source_card_id: string; request_id: string };

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  const actual = Buffer.from(req.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret ?? ""}`);
  if (!secret || actual.length !== expected.length || !timingSafeEqual(actual, expected))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const day = getKstDateString();
  const deadline = AbortSignal.timeout(48000);
  const admin = createAdminClient({ signal: deadline });
  const result = { checked: 0, sent: 0, errors: 0 };
  try {
    const claimed = await admin.rpc("claim_dating_1on1_winter_alert_checks", { p_limit: 12 });
    if (claimed.error) throw claimed.error;
    const rows = (claimed.data ?? []) as Alert[];
    for (let i = 0; i < rows.length && !deadline.aborted; i += 3) {
      await Promise.all(rows.slice(i, i + 3).map(async row => {
        if (!isWinterExpansionEnabled(row.user_id)) return;
        result.checked++;
        try {
          const preview = await readOneOnOneWinterAvailability(admin, { id: row.user_id }, row.source_card_id, day);
          if (!preview?.repeated || !preview.count || preview.claimed || deadline.aborted) return;
          const sent = await admin.rpc("deliver_dating_1on1_winter_alert", {
            p_user: row.user_id, p_card: row.source_card_id, p_request: row.request_id, p_day: day,
          });
          if (sent.error) throw sent.error;
          if (sent.data === true) result.sent++;
        } catch {
          result.errors++;
        }
      }));
    }
    if (result.errors) console.error("[1on1-winter-alert] delivery issues", { errors: result.errors });
    return NextResponse.json({ ok: true, ...result }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    console.error("[1on1-winter-alert] scheduled checks unavailable");
    return NextResponse.json({ ok: false }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
