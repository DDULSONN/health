import { requireAdminRoute } from "@/lib/admin-route";
import { ensureAllowedMutationOrigin } from "@/lib/request-origin";
import { FRIEND_UUID } from "@/lib/friend-recommendation";
import { friendBody, friendFailure, friendJson, type FriendLink } from "@/lib/friend-recommendation-server";
export async function GET(req: Request) {
  const auth = await requireAdminRoute(); if (!auth.ok) return auth.response;
  try {
    const params = new URL(req.url).searchParams; const search = (params.get("q") ?? "").trim();
    const before = params.get("before"); const [at, id, extra] = (before ?? "").split("|");
    if (search.length > 40 || (before && (extra || !FRIEND_UUID.test(id ?? "") || !/^\d{4}-\d{2}-\d{2}T[\d:.]+(?:Z|\+00:00)$/.test(at) || !Number.isFinite(Date.parse(at))))) return friendJson({ error: "검색 조건을 확인해 주세요." }, 400);
    let query = auth.admin.from("dating_friend_shares").select("id,user_id,prompt,items,created_at,expires_at,revoked_at,revoked_by,revoke_reason").order("created_at", { ascending: false }).order("id", { ascending: false }).limit(21);
    if (search) {
      const profiles = FRIEND_UUID.test(search) ? { data: [{ user_id: search }], error: null } : await auth.admin.from("profiles").select("user_id").ilike("nickname", `%${search.replace(/[\\%_]/g, "\\$&")}%`).limit(51);
      if (profiles.error) throw profiles.error;
      if ((profiles.data?.length ?? 0) > 50) return friendJson({ error: "검색 결과가 많아요. 닉네임을 더 정확히 입력해 주세요." }, 400);
      if (!profiles.data?.length) return friendJson({ items: [], next: null });
      query = query.in("user_id", profiles.data.map(p => p.user_id));
    }
    if (before) query = query.or(`created_at.lt.${at},and(created_at.eq.${at},id.lt.${id})`);
    const result = await query; if (result.error) throw result.error;
    const rows = (result.data ?? []).slice(0, 20) as unknown as FriendLink[];
    const ids = [...new Set(rows.flatMap(row => [row.user_id, ...row.items.map(item => item.user_id)]).filter((value): value is string => Boolean(value)))];
    const names = ids.length ? await auth.admin.from("profiles").select("user_id,nickname").in("user_id", ids) : { data: [], error: null };
    if (names.error) throw names.error;
    const nicknames = new Map((names.data ?? []).map(row => [row.user_id, row.nickname]));
    const last = rows.at(-1);
    return friendJson({ items: rows.map(row => ({ ...row, nickname: nicknames.get(row.user_id) ?? "탈퇴 회원", items: row.items.map(item => ({ ...item, nickname: item.label ? `${item.label} (계정: ${nicknames.get(item.user_id) ?? "탈퇴 회원"})` : nicknames.get(item.user_id) ?? "탈퇴 회원" })) })), next: (result.data?.length ?? 0) > 20 && last ? `${last.created_at}|${last.id}` : null });
  } catch (error) { return friendFailure(error); }
}
export async function POST(req: Request) {
  const origin = ensureAllowedMutationOrigin(req); if (origin) return origin;
  const auth = await requireAdminRoute(); if (!auth.ok) return auth.response;
  try {
    const body = await friendBody(req);
    if (typeof body?.id !== "string" || !FRIEND_UUID.test(body.id) || typeof body.note !== "string" || body.note.trim().length < 2 || body.note.length > 200) return friendJson({ error: "종료 사유를 입력해 주세요." }, 400);
    const result = await auth.admin.from("dating_friend_shares").update({ revoked_at: new Date().toISOString(), revoked_by: auth.user.id, revoke_reason: body.note.trim() }).eq("id", body.id).is("revoked_at", null);
    if (result.error) throw result.error;
    return friendJson({ ok: true });
  } catch (error) { return friendFailure(error); }
}
