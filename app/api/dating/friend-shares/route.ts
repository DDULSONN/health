import { createAdminClient } from "@/lib/supabase/server";
import { getRequestAuthContext } from "@/lib/supabase/request";
import { ensureAllowedMutationOrigin } from "@/lib/request-origin";
import { FRIEND_PROMPTS, FRIEND_UUID, friendSelections, type FriendPrompt } from "@/lib/friend-recommendation";
import { createFriendLink, friendBody, friendFailure, friendJson, friendMember, friendPreference } from "@/lib/friend-recommendation-server";

export async function GET(req: Request) {
  const { user } = await getRequestAuthContext(req);
  if (!user) return friendJson({ error: "로그인이 필요해요." }, 401);
  try {
    const admin = createAdminClient();
    await friendMember(admin, user.id, false);
    const [pref, links] = await Promise.all([
      friendPreference(admin, user.id),
      admin.from("dating_friend_shares").select("id,token,prompt,created_at,expires_at,revoked_at").eq("user_id", user.id)
        .is("revoked_at", null).gt("expires_at", new Date().toISOString()).order("created_at", { ascending: false }).limit(10),
    ]);
    if (links.error) throw links.error;
    return friendJson({ enabled: pref.enabled, links: links.data ?? [] });
  } catch (error) { return friendFailure(error); }
}
export async function POST(req: Request) {
  const origin = ensureAllowedMutationOrigin(req); if (origin) return origin;
  const { user } = await getRequestAuthContext(req);
  if (!user) return friendJson({ error: "로그인이 필요해요." }, 401);
  try {
    const body = await friendBody(req); const admin = createAdminClient();
    if (body?.action === "preference") {
      if (typeof body.enabled !== "boolean") return friendJson({ error: "설정을 확인해 주세요." }, 400);
      await friendMember(admin, user.id, false);
      const result = await admin.rpc("set_dating_friend_share_preference", { p_user: user.id, p_enabled: body.enabled });
      if (result.error) throw result.error;
      return friendJson({ ok: true, enabled: body.enabled });
    }
    if (body?.action === "revoke") {
      if (typeof body.id !== "string" || !FRIEND_UUID.test(body.id)) return friendJson({ error: "링크를 확인해 주세요." }, 400);
      const result = await admin.from("dating_friend_shares").update({ revoked_at: new Date().toISOString(), revoked_by: user.id, revoke_reason: "sender" }).eq("id", body.id).eq("user_id", user.id).is("revoked_at", null);
      if (result.error) throw result.error;
      return friendJson({ ok: true });
    }
    const selections = friendSelections(body?.items);
    if (!selections || typeof body.requestKey !== "string" || !FRIEND_UUID.test(body.requestKey) || !Object.hasOwn(FRIEND_PROMPTS, body.prompt)) return friendJson({ error: "추천할 프로필을 확인해 주세요." }, 400);
    const link = await createFriendLink(admin, user.id, body.requestKey, body.prompt as FriendPrompt, selections);
    return friendJson({ id: link.id, path: `/s/${link.token}`, expiresAt: link.expires_at });
  } catch (error) { return friendFailure(error); }
}
