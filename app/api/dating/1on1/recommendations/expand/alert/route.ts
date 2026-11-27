import { NextResponse } from "next/server";
import { isWinterExpansionEnabled } from "@/lib/dating-1on1-expansion";
import { readOneOnOneWinterAvailability } from "@/lib/dating-1on1-winter-expansion";
import { ensureAllowedMutationOrigin } from "@/lib/request-origin";
import { getRequestAuthContext } from "@/lib/supabase/request";
import { createAdminClient } from "@/lib/supabase/server";

const table = "dating_1on1_winter_candidate_alerts";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const reply = (data: unknown, status = 200) =>
  NextResponse.json(data, { status, headers: { "Cache-Control": "private, no-store" } });
const unavailable = () => reply({ error: "알림 설정을 확인하지 못했어요. 잠시 뒤 다시 시도해 주세요." }, 503);

export async function GET(req: Request) {
  const { user } = await getRequestAuthContext(req);
  if (!user) return reply({ error: "로그인이 필요해요." }, 401);
  if (!isWinterExpansionEnabled(user.id)) return reply({ enabled: false }, 404);
  const sourceId = new URL(req.url).searchParams.get("source_card_id");
  if (!sourceId || !uuid.test(sourceId)) return reply({ error: "프로필을 다시 확인해 주세요." }, 400);
  try {
    const { data, error } = await createAdminClient().from(table).select("request_id")
      .eq("user_id", user.id).eq("source_card_id", sourceId).is("sent_at", null)
      .gt("requested_at", new Date(Date.now() - 7 * 86400000).toISOString()).maybeSingle();
    if (error) throw error;
    return reply({ enabled: Boolean(data) });
  } catch {
    console.error("[1on1-winter-alert] preference read failed");
    return unavailable();
  }
}

export async function POST(req: Request) {
  const origin = ensureAllowedMutationOrigin(req);
  if (origin) return origin;
  const { user } = await getRequestAuthContext(req);
  if (!user) return reply({ error: "로그인이 필요해요." }, 401);
  const body = await req.json().catch(() => null);
  const sourceId = body?.source_card_id;
  const enabled = body?.enabled;
  if (typeof sourceId !== "string" || !uuid.test(sourceId) || typeof enabled !== "boolean")
    return reply({ error: "알림 설정을 다시 확인해 주세요." }, 400);
  if (enabled && !isWinterExpansionEnabled(user.id)) return reply({ error: "현재 이용할 수 없는 기능이에요." }, 404);
  try {
    const admin = createAdminClient({ signal: AbortSignal.any([req.signal, AbortSignal.timeout(7200)]) });
    if (enabled) {
      const preview = await readOneOnOneWinterAvailability(admin, { id: user.id }, sourceId);
      if (!preview) return unavailable();
      if (!preview.repeated || preview.count !== 0)
        return reply({ error: "지금 확인할 수 있는 후보가 있는지 다시 확인해 주세요." }, 409);
    }
    const { data, error } = await admin.rpc("set_dating_1on1_winter_alert", {
      p_user: user.id, p_card: sourceId, p_enabled: enabled,
    });
    if (error) throw error;
    if (data !== enabled) return reply({ error: "현재 프로필 상태를 다시 확인해 주세요." }, 409);
    return reply({ enabled: data === true });
  } catch {
    console.error("[1on1-winter-alert] preference update failed");
    return unavailable();
  }
}
