import sharp from "sharp";
import { randomUUID } from "node:crypto";
import { getRequestAuthContext } from "@/lib/supabase/request";
import { createAdminClient } from "@/lib/supabase/server";
import { extractStorageObjectPathFromBuckets } from "@/lib/images";
import { FRIEND_UUID } from "@/lib/friend-recommendation";
import { FRIEND_HEADERS, FriendError, friendFailure, readFriendLink } from "@/lib/friend-recommendation-server";
import { checkRouteRateLimit, extractClientIp } from "@/lib/request-rate-limit";
export const runtime = "nodejs";
export async function GET(req: Request, context: { params: Promise<{ token: string; itemId: string; index: string }> }) {
  try {
    const { token, itemId, index } = await context.params;
    if (!FRIEND_UUID.test(itemId) || !/^[01]$/.test(index)) throw new FriendError(404, "사진을 확인해 주세요.");
    const { user } = await getRequestAuthContext(req);
    const rate = await checkRouteRateLimit({ requestId: randomUUID(), scope: "friend-photo", userId: user?.id ?? null, ip: extractClientIp(req), userLimitPerMin: 60, ipLimitPerMin: 40 });
    if (!rate.allowed) throw new FriendError(429, "잠시 후 다시 확인해 주세요.");
    const admin = createAdminClient(); const result = await readFriendLink(admin, token, user?.id ?? null, itemId);
    const target = result.items.find(entry => entry.item.id === itemId);
    if (!target) throw new FriendError(410, "볼 수 없는 사진이에요.");
    const bucket = target.item.kind === "one_on_one" ? "dating-1on1-photos" : "dating-card-photos";
    const raw = target.card.photos[Number(index)];
    const path = raw && extractStorageObjectPathFromBuckets(raw, [bucket]);
    if (!path || !path.startsWith(`cards/${target.card.user_id}/`) || path.includes("\\") || path.split("/").includes("..") || /%2f|%5c|%2e/i.test(path)) throw new FriendError(404, "사진을 확인해 주세요.");
    const file = await admin.storage.from(bucket).download(path);
    if (file.error || !file.data || file.data.size > 15 * 1024 * 1024) throw new FriendError(404, "사진을 불러오지 못했어요.");
    const hidden = !result.detailed || target.card.blur;
    let pipeline = sharp(Buffer.from(await file.data.arrayBuffer()), { limitInputPixels: 40000000 }).rotate().resize({ width: hidden ? 120 : 640, height: hidden ? 160 : 800, fit: "inside", withoutEnlargement: true });
    if (hidden) pipeline = pipeline.blur(18);
    const output = await pipeline.webp({ quality: hidden ? 45 : 78 }).toBuffer();
    // Recheck revocation/OFF after slow image processing. Never cache conditional photos.
    const latest = await readFriendLink(admin, token, user?.id ?? null, itemId);
    const current = latest.items.find(entry => entry.item.id === itemId);
    if (!current || current.card.photos[Number(index)] !== raw || current.card.blur !== target.card.blur || latest.detailed !== result.detailed) throw new FriendError(410, "공유 설정이 바뀌었어요.");
    return new Response(new Uint8Array(output), { headers: { ...FRIEND_HEADERS, "Content-Type": "image/webp", "X-Content-Type-Options": "nosniff" } });
  } catch (error) { return friendFailure(error); }
}
