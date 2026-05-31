import { NextResponse } from "next/server";
import { requireAdminRoute } from "@/lib/admin-route";
import { ensureAllowedMutationOrigin } from "@/lib/request-origin";

const TABLE = "email_marketing_unsubscribes";

type UnsubscribeRow = {
  id: string;
  user_id: string;
  email: string | null;
  campaign_key: string;
  source: string | null;
  reason: string | null;
  unsubscribed_at: string;
  created_at: string | null;
};

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function normalizeQuery(value: string | null) {
  return String(value ?? "").trim();
}

function isMissingTableError(error: { code?: string; message?: string } | null | undefined) {
  const code = String(error?.code ?? "");
  const message = String(error?.message ?? "").toLowerCase();
  return code === "42P01" || code === "PGRST205" || message.includes(TABLE);
}

export async function GET(request: Request) {
  const auth = await requireAdminRoute();
  if (!auth.ok) return auth.response;

  const { searchParams } = new URL(request.url);
  const query = normalizeQuery(searchParams.get("query"));
  if (query.length < 2) {
    return NextResponse.json({ error: "이메일 또는 사용자 ID를 2글자 이상 입력해 주세요." }, { status: 400 });
  }

  let dbQuery = auth.admin
    .from(TABLE)
    .select("id,user_id,email,campaign_key,source,reason,unsubscribed_at,created_at")
    .order("unsubscribed_at", { ascending: false })
    .limit(30);

  dbQuery = isUuid(query) ? dbQuery.eq("user_id", query) : dbQuery.ilike("email", `%${query}%`);
  const res = await dbQuery;

  if (res.error) {
    if (isMissingTableError(res.error)) {
      return NextResponse.json({ error: "수신거부 테이블이 아직 없습니다." }, { status: 500 });
    }
    console.error("[GET /api/admin/email-unsubscribes] failed", res.error);
    return NextResponse.json({ error: "수신거부 목록을 불러오지 못했습니다." }, { status: 500 });
  }

  const rows = (res.data ?? []) as UnsubscribeRow[];
  const userIds = [...new Set(rows.map((row) => row.user_id).filter(Boolean))];
  const nicknameByUserId = new Map<string, string>();
  if (userIds.length > 0) {
    const profileRes = await auth.admin.from("profiles").select("user_id,nickname").in("user_id", userIds);
    if (!profileRes.error) {
      for (const profile of profileRes.data ?? []) {
        const userId = String(profile.user_id ?? "");
        const nickname = typeof profile.nickname === "string" ? profile.nickname : "";
        if (userId && nickname) nicknameByUserId.set(userId, nickname);
      }
    }
  }

  return NextResponse.json({
    ok: true,
    items: rows.map((row) => ({
      ...row,
      nickname: nicknameByUserId.get(row.user_id) ?? null,
    })),
  });
}

export async function DELETE(request: Request) {
  const originResponse = ensureAllowedMutationOrigin(request);
  if (originResponse) return originResponse;

  const auth = await requireAdminRoute();
  if (!auth.ok) return auth.response;

  const body = (await request.json().catch(() => ({}))) as { id?: unknown };
  const id = typeof body.id === "string" ? body.id.trim() : "";
  if (!id) {
    return NextResponse.json({ error: "삭제할 수신거부 ID가 필요합니다." }, { status: 400 });
  }

  const res = await auth.admin.from(TABLE).delete().eq("id", id).select("id").maybeSingle();
  if (res.error) {
    console.error("[DELETE /api/admin/email-unsubscribes] failed", res.error);
    return NextResponse.json({ error: "수신거부 해제에 실패했습니다." }, { status: 500 });
  }
  if (!res.data) {
    return NextResponse.json({ error: "수신거부 기록을 찾지 못했습니다." }, { status: 404 });
  }

  return NextResponse.json({ ok: true, id });
}
