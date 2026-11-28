import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { processSupportInquiry } from "@/lib/support-auto-reply";
import { SUPPORT_AUTO_START, triageSupport } from "@/lib/support-triage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const admin = createAdminClient({ signal: AbortSignal.timeout(45000) });
  let scanned = 0, answered = 0, failed = 0;
  // Snapshot ids before updating: offset pagination must not skip rows as they
  // leave the open queue. Oldest first; never silently cap the scan to 100 rows.
  const ids: string[] = [];
  try {
    for (let offset = 0; ; offset += 500) {
      const page = await admin.from("support_inquiries").select("id,category,subject,message").eq("status", "open").is("admin_reply", null).is("answered_at", null).is("answered_by_user_id", null)
        .gte("created_at", SUPPORT_AUTO_START).order("created_at").order("id").range(offset, offset + 499);
      if (page.error) throw new Error("queue_read_failed");
      scanned += page.data?.length ?? 0;
      ids.push(...(page.data ?? []).filter(row => triageSupport(row).kind === "simple").map(row => String(row.id)));
      if ((page.data?.length ?? 0) < 500) break;
    }
    for (const id of ids) {
      try { if (await processSupportInquiry(id, admin) === "answered") answered++; }
      catch { failed++; }
    }
    return NextResponse.json({ ok: failed === 0, scanned, answered, failed }, { status: failed ? 500 : 200 });
  } catch { return NextResponse.json({ ok: false, error: "support_sweep_failed", scanned, answered, failed }, { status: 500 }); }
}
