import { NextResponse } from "next/server";
import { requireAdminRoute } from "@/lib/admin-route";
import { isAllowedAdminUser } from "@/lib/admin";
import { loadCandidateById } from "@/lib/admin-dating-card-review";
import { ensureAllowedMutationOrigin } from "@/lib/request-origin";

export async function GET(req: Request) {
  const auth = await requireAdminRoute();
  if (!auth.ok) return auth.response;
  const url = new URL(req.url);
  const view = url.searchParams.get("view") || "attention";
  const page = Math.floor(Math.max(0, Math.min(10000, Number(url.searchParams.get("page")) || 0)));
  let q = auth.admin.from("dating_profile_review_jobs")
    .select("source_type,card_id,user_id,revision,payload,state,resolution,attempts,result,error,updated_at,reviewed_at", { count: "exact" })
    .order("updated_at", { ascending: false }).order("card_id").range(page * 20, page * 20 + 19);
  if (view === "history") q = q.neq("resolution", "open");
  else if (view === "processing") q = q.eq("resolution", "open").in("state", ["queued", "running"]);
  else if (view === "clear") q = q.eq("resolution", "open").eq("state", "complete").eq("result->>suspicionLevel", "clear");
  else q = q.eq("resolution", "open").or("state.eq.failed,and(state.eq.complete,result->>suspicionLevel.neq.clear)");
  const { data, error, count } = await q;
  if (error) return NextResponse.json({ error: "자동 검수 목록을 읽을 수 없습니다. DB 마이그레이션 적용 여부를 확인해 주세요." }, { status: 500 });
  const items = await Promise.all((data ?? []).map(async job => {
    const current = await loadCandidateById(auth.admin, job.source_type, job.card_id);
    return { ...job, current };
  }));
  return NextResponse.json({ items, total: count ?? 0, page });
}

export async function PATCH(req: Request) {
  const originError = ensureAllowedMutationOrigin(req);
  if (originError) return originError;
  const auth = await requireAdminRoute();
  if (!auth.ok) return auth.response;
  const body = await req.json().catch(() => ({}));
  const { source, cardId, revision, action } = body;
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!["open_card", "one_on_one"].includes(source) || !uuid.test(String(cardId)) || !uuid.test(String(revision)) || !["clear", "ban", "delete", "retry"].includes(action)) {
    return NextResponse.json({ error: "처리 대상을 확인해 주세요." }, { status: 400 });
  }
  if (action === "ban") {
    const card = await loadCandidateById(auth.admin, source, cardId);
    if (!card?.userId) return NextResponse.json({ error: "프로필을 찾을 수 없습니다." }, { status: 404 });
    const target = await auth.admin.auth.admin.getUserById(card.userId);
    if (target.error) return NextResponse.json({ error: "계정 확인 실패" }, { status: 500 });
    if (card.userId === auth.user.id || isAllowedAdminUser(card.userId, target.data.user.email)) {
      return NextResponse.json({ error: "관리자 계정은 밴할 수 없습니다." }, { status: 400 });
    }
  }
  const result = await auth.admin.rpc("resolve_dating_profile_review", { s: source, c: cardId, v: revision, decision: action, actor: auth.user.id });
  if (result.error) return NextResponse.json({ error: "내용이 변경되었거나 처리할 수 없는 상태입니다. 새로고침 후 확인해 주세요." }, { status: 409 });
  return NextResponse.json({ ok: true });
}
