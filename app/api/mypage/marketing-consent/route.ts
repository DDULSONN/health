import { NextResponse } from "next/server";

import { ensureAllowedMutationOrigin } from "@/lib/request-origin";
import { createClient, createAdminClient } from "@/lib/supabase/server";

const TABLE = "email_marketing_unsubscribes";
const CAMPAIGNS_TO_CLEAR = [
  "all",
  "dating_registration_reminder",
  "open_card_outreach",
  "one_on_one_outreach",
  "dating_notifications",
];

function isMissingTableError(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const code = "code" in error ? String(error.code ?? "") : "";
  const message = "message" in error ? String(error.message ?? "").toLowerCase() : "";
  return code === "42P01" || code === "PGRST205" || message.includes(TABLE) || message.includes("schema cache");
}

function getClientIp(request: Request) {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip")?.trim() ||
    null
  );
}

async function getCurrentUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }

  const admin = createAdminClient();
  const res = await admin
    .from(TABLE)
    .select("id,campaign_key,unsubscribed_at")
    .eq("user_id", user.id)
    .in("campaign_key", CAMPAIGNS_TO_CLEAR)
    .order("unsubscribed_at", { ascending: false });

  if (res.error) {
    if (isMissingTableError(res.error)) {
      return NextResponse.json({ opted_out: false, missing_table: true });
    }
    console.error("[GET /api/mypage/marketing-consent] failed", res.error);
    return NextResponse.json({ error: "수신 설정을 불러오지 못했습니다." }, { status: 500 });
  }

  const rows = res.data ?? [];
  return NextResponse.json({
    opted_out: rows.length > 0,
    unsubscribed_at: rows[0]?.unsubscribed_at ?? null,
  });
}

export async function POST(request: Request) {
  const originResponse = ensureAllowedMutationOrigin(request);
  if (originResponse) return originResponse;

  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as { opted_out?: unknown };
  const optedOut = body.opted_out === true;
  const admin = createAdminClient();

  if (!optedOut) {
    const deleteRes = await admin
      .from(TABLE)
      .delete()
      .eq("user_id", user.id)
      .in("campaign_key", CAMPAIGNS_TO_CLEAR)
      .select("id");

    if (deleteRes.error) {
      if (isMissingTableError(deleteRes.error)) {
        return NextResponse.json({ ok: true, opted_out: false, missing_table: true });
      }
      console.error("[POST /api/mypage/marketing-consent] opt-in failed", deleteRes.error);
      return NextResponse.json({ error: "수신거부 해제에 실패했습니다." }, { status: 500 });
    }

    return NextResponse.json({ ok: true, opted_out: false });
  }

  const upsertRes = await admin.from(TABLE).upsert(
    {
      user_id: user.id,
      email: user.email ?? null,
      campaign_key: "all",
      source: "mypage",
      reason: "user_requested",
      user_agent: request.headers.get("user-agent") ?? null,
      ip_address: getClientIp(request),
      unsubscribed_at: new Date().toISOString(),
    },
    { onConflict: "user_id,campaign_key" }
  );

  if (upsertRes.error) {
    if (isMissingTableError(upsertRes.error)) {
      return NextResponse.json({ error: "수신거부 테이블이 아직 적용되지 않았습니다." }, { status: 500 });
    }
    console.error("[POST /api/mypage/marketing-consent] opt-out failed", upsertRes.error);
    return NextResponse.json({ error: "수신거부 처리에 실패했습니다." }, { status: 500 });
  }

  return NextResponse.json({ ok: true, opted_out: true });
}
