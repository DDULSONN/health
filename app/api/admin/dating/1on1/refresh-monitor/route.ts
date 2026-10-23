import { NextResponse } from "next/server";
import { requireAdminRoute } from "@/lib/admin-route";
import { ensureAllowedMutationOrigin } from "@/lib/request-origin";
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
const modes = ["off", "observe", "repair"];

export async function GET(req: Request) {
  const guard = await requireAdminRoute();
  if (!guard.ok) return guard.response;
  const page = Number(new URL(req.url).searchParams.get("page") ?? 0);
  if (!Number.isInteger(page) || page < 0 || page > 10000) return json({ error: "페이지를 확인해 주세요." }, 400);
  const setting = await guard.admin.from("dating_1on1_refresh_monitor_settings").select("mode,email_enabled").eq("singleton", true).single();
  if (setting.error) return ["42P01", "PGRST205"].includes(setting.error.code)
    ? json({ configured: false }) : json({ error: "점검 설정을 읽지 못했습니다." }, 503);
  const [list, pending] = await Promise.all([
    guard.admin.from("dating_1on1_refresh_audits").select("id,user_id,day_key,attempt_id,state,finding,checked_at,repaired_at,email_state", { count: "exact" })
      .order("day_key", { ascending: false }).order("id", { ascending: false }).range(page * 20, page * 20 + 19),
    guard.admin.from("dating_1on1_refresh_audits").select("id", { count: "exact", head: true }).in("state", ["queued", "running"]),
  ]);
  if (list.error || pending.error) return json({ error: "점검 결과를 읽지 못했습니다." }, 503);
  const attempts = list.data?.length ? await guard.admin.from("dating_1on1_refresh_attempts")
    .select("id,source_card_id,outcome,changed_count,rotated_count,pool_count,before_user_ids,after_user_ids,widened_count,age_mismatch_count")
    .in("id", list.data.map(row => row.attempt_id)) : { data: [], error: null };
  if (attempts.error) return json({ error: "새로고침 기록을 읽지 못했습니다." }, 503);
  const cards = attempts.data?.length ? await guard.admin.from("dating_1on1_cards").select("id,name")
    .in("id", attempts.data.map(row => row.source_card_id)) : { data: [], error: null };
  if (cards.error) return json({ error: "프로필 이름을 읽지 못했습니다." }, 503);
  return json({ configured: true, settings: setting.data, total: list.count ?? 0, pending: pending.count ?? 0,
    items: (list.data ?? []).map(row => {
      const attempt = attempts.data?.find(a => a.id === row.attempt_id);
      const before = new Set(attempt?.before_user_ids ?? []);
      const after = new Set<string>(attempt?.after_user_ids ?? []);
      return { id: row.id, day: row.day_key, state: row.state, finding: row.finding, checkedAt: row.checked_at,
        repairedAt: row.repaired_at, emailState: row.email_state,
        name: cards.data?.find(c => c.id === attempt?.source_card_id)?.name ?? "삭제된 프로필",
        pool: attempt?.pool_count ?? 0, overlap: [...after].filter(id => before.has(id)).length, shown: after.size,
        widened: attempt?.widened_count ?? 0, ageMismatch: attempt?.age_mismatch_count ?? 0 };
    }),
  });
}

export async function PATCH(req: Request) {
  const origin = ensureAllowedMutationOrigin(req);
  if (origin) return origin;
  const guard = await requireAdminRoute();
  if (!guard.ok) return guard.response;
  const body = await req.json().catch(() => null);
  if (!body || !modes.includes(body.mode) || typeof body.email_enabled !== "boolean"
    || !modes.includes(body.expected_mode) || typeof body.expected_email_enabled !== "boolean")
    return json({ error: "설정 값을 확인해 주세요." }, 400);
  if (body.mode !== "repair" && body.email_enabled) return json({ error: "복구 모드에서만 메일을 켤 수 있습니다." }, 400);
  const result = await guard.admin.from("dating_1on1_refresh_monitor_settings")
    .update({ mode: body.mode, email_enabled: body.email_enabled }).eq("singleton", true)
    .eq("mode", body.expected_mode).eq("email_enabled", body.expected_email_enabled).select("mode,email_enabled").maybeSingle();
  if (result.error) return json({ error: "설정을 저장하지 못했습니다." }, 503);
  if (!result.data) return json({ error: "다른 화면에서 설정이 바뀌었습니다. 다시 불러와 주세요." }, 409);
  return json({ ok: true, settings: result.data });
}
