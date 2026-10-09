import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { getRequestAuthContext } from "@/lib/supabase/request";
import { ensureAllowedMutationOrigin } from "@/lib/request-origin";
import { getKstDateString } from "@/lib/weekly";
import { EXPANSION_LIMIT, EXPANSION_TABLE, isExpansionEnabled } from "@/lib/dating-1on1-expansion";
import { loadOneOnOneRecommendations } from "@/lib/dating-1on1-recommendation-service";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Batch = { source_card_id: string; candidate_ids: string[]; day_key: string };
const validIds = (ids: unknown): ids is string[] => Array.isArray(ids) && ids.length <= EXPANSION_LIMIT &&
  ids.every(id => typeof id === "string" && uuid.test(id)) && new Set(ids).size === ids.length;
const validBatch = (batch: Batch, day: string) => batch && uuid.test(batch.source_card_id) && batch.day_key === day &&
  validIds(batch.candidate_ids) && !batch.candidate_ids.includes(batch.source_card_id);
const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
const unavailable = () => reply({ error: "추가 후보를 확인하지 못했어요. 기존 추천과 새로고침 횟수는 그대로예요. 잠시 후 다시 시도해 주세요." }, 503);

export async function POST(req: Request) {
  const originError = ensureAllowedMutationOrigin(req);
  if (originError) return originError;
  const { user } = await getRequestAuthContext(req);
  if (!user) return reply({ error: "로그인이 필요합니다." }, 401);
  if (!isExpansionEnabled(user.id)) return reply({ error: "아직 이용할 수 없는 기능입니다." }, 404);
  const body = await req.json().catch(() => null);
  const sourceId = body?.source_card_id;
  if (typeof sourceId !== "string" || !uuid.test(sourceId)) return reply({ error: "프로필을 다시 확인해 주세요." }, 400);
  const day = getKstDateString();
  const admin = createAdminClient();
  try {
    // Never take candidate IDs, a day override or a refresh seed from the browser.
    const saved = await admin.from(EXPANSION_TABLE).select("source_card_id,candidate_ids,day_key")
      .eq("user_id", user.id).eq("day_key", day).maybeSingle();
    if (saved.error) return unavailable();
    let batch = saved.data as Batch | null;
    if (batch && !validBatch(batch, day)) return unavailable();
    if (batch && batch.source_card_id !== sourceId) return reply({ error: "오늘 확인한 후보는 이전 프로필 기준이에요. 새 프로필의 추가 후보는 내일 확인할 수 있어요." }, 409);
    const response = await loadOneOnOneRecommendations(admin, user, undefined, { candidateIds: batch?.candidate_ids });
    if (response.status === 403) return reply({ error: "휴대폰 인증과 현재 프로필 상태를 확인해 주세요." }, 403);
    if (!response.ok) return unavailable();
    let result = await response.json();
    if (result.source_card_id !== sourceId || !Array.isArray(result.candidates)) return reply({ error: "현재 사용 중인 프로필을 다시 불러와 주세요." }, 409);
    if (!validIds(result.candidates.map((candidate: { id?: string } | null) => candidate?.id))) return unavailable();
    if (!batch) {
      const ids = result.candidates.map((candidate: { id: string }) => candidate.id);
      const claimed = await admin.rpc("claim_dating_1on1_expansion_batch", {
        p_user_id: user.id, p_source_card_id: sourceId, p_day_key: day, p_candidate_ids: ids,
      });
      if (claimed.error || !Array.isArray(claimed.data) || claimed.data.length !== 1) return unavailable();
      batch = claimed.data[0] as Batch;
      if (!validBatch(batch, day) || batch.source_card_id !== sourceId) return unavailable();
      if (JSON.stringify(ids) !== JSON.stringify(batch.candidate_ids)) {
        const winner = await loadOneOnOneRecommendations(admin, user, undefined, { candidateIds: batch.candidate_ids });
        if (!winner.ok) return unavailable();
        result = await winner.json();
        if (result.source_card_id !== sourceId || !Array.isArray(result.candidates)) return unavailable();
      }
    }
    if (!validIds(result.candidates.map((candidate: { id?: string } | null) => candidate?.id)) ||
        result.candidates.some((candidate: { id: string }) => !batch!.candidate_ids.includes(candidate.id))) return unavailable();
    if (getKstDateString() !== day) return reply({ error: "날짜가 바뀌었어요. 추가 후보를 다시 확인해 주세요." }, 409);
    return reply({ source_card_id: sourceId, day_key: day, candidates: result.candidates,
      expires_at: new Date(Date.parse(`${day}T00:00:00+09:00`) + 86400000).toISOString() });
  } catch (error) {
    console.error("[dating-expansion] unavailable", { code: (error as { code?: string })?.code });
    return unavailable();
  }
}
