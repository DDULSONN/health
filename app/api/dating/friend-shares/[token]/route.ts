import { randomUUID } from "node:crypto";
import { getRequestAuthContext } from "@/lib/supabase/request";
import { createAdminClient } from "@/lib/supabase/server";
import { checkRouteRateLimit, extractClientIp } from "@/lib/request-rate-limit";
import { friendFailure, friendJson, readFriendLink, projectFriendItem, FRIEND_PROMPTS } from "@/lib/friend-recommendation-server";
export async function GET(req: Request, context: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await context.params;
    const { user } = await getRequestAuthContext(req);
    const rate = await checkRouteRateLimit({ requestId: randomUUID(), scope: "friend-read", userId: user?.id ?? null, ip: extractClientIp(req), userLimitPerMin: 30, ipLimitPerMin: 30 });
    if (!rate.allowed) return friendJson({ error: "잠시 후 다시 확인해 주세요." }, 429);
    const result = await readFriendLink(createAdminClient(), token, user?.id ?? null);
    return friendJson({ prompt: FRIEND_PROMPTS[result.link.prompt], expiresAt: result.link.expires_at,
      access: result.detailed ? "member" : result.viewer ? "verify" : "guest",
      items: result.items.map(({ item, card }) => projectFriendItem(token, item, card, result.detailed)) });
  } catch (error) { return friendFailure(error); }
}
