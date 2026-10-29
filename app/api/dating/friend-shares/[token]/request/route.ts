import { getRequestAuthContext } from "@/lib/supabase/request";
import { createAdminClient } from "@/lib/supabase/server";
import { ensureAllowedMutationOrigin } from "@/lib/request-origin";
import { FRIEND_UUID, friendProfileWriteHref } from "@/lib/friend-recommendation";
import { friendBody, friendFailure, friendJson, readFriendLink, friendRequestProfile } from "@/lib/friend-recommendation-server";
import { POST as createMatchRequest } from "@/app/api/dating/1on1/matches/auto/route";
export async function POST(req: Request, context: { params: Promise<{ token: string }> }) {
  const origin = ensureAllowedMutationOrigin(req); if (origin) return origin;
  const { user } = await getRequestAuthContext(req);
  if (!user) return friendJson({ error: "로그인 후 확인해 주세요." }, 401);
  try {
    const { token } = await context.params; const body = await friendBody(req);
    if (typeof body?.itemId !== "string" || !FRIEND_UUID.test(body.itemId)) return friendJson({ error: "프로필을 선택해 주세요." }, 400);
    const admin = createAdminClient(); const result = await readFriendLink(admin, token, user.id);
    if (!result.detailed) return friendJson({ error: "휴대폰 인증 후 이용해 주세요." }, 403);
    const target = result.items.find(entry => entry.item.id === body.itemId);
    if (!target || target.item.user_id === user.id) return friendJson({ error: "현재 신청할 수 없는 프로필이에요." }, 409);
    if (target.item.kind !== "one_on_one") return friendJson({ href: target.item.kind === "paid_card" ? `/dating/paid/${target.card.id}/apply` : `/community/dating/cards/${target.card.id}/apply` });
    const own = await friendRequestProfile(admin, user.id);
    if (!own) return friendJson({ error: "내 1:1 프로필을 먼저 작성해 주세요. 작성 후 이 추천으로 돌아와요.", profileHref: friendProfileWriteHref(token, target.item.id) }, 409);
    if (body.confirm !== true) return friendJson({ error: "요청을 확인해 주세요." }, 400);
    // Reuse the normal endpoint: same identity/block/pair checks, notifications,
    // and duplicate prevention. No payment or contact-exchange writes here.
    const headers = new Headers(req.headers); headers.delete("content-length"); headers.set("content-type", "application/json");
    return createMatchRequest(new Request(req.url, { method: "POST", headers, body: JSON.stringify({ source_card_id: own.id, candidate_card_id: target.card.id }) }));
  } catch (error) { return friendFailure(error); }
}
