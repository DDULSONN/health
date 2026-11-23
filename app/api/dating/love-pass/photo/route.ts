import { hasLovePassNearbyCardAccess } from "@/lib/dating-love-pass-access";
import { getLovePassPhotoPaths } from "@/lib/dating-love-pass-photos";
import { checkRouteRateLimit, extractClientIp } from "@/lib/request-rate-limit";
import { getRequestAuthContext } from "@/lib/supabase/request";
import { createAdminClient } from "@/lib/supabase/server";

const headers = { "Cache-Control": "private, no-store", Vary: "Cookie, Authorization", "X-Content-Type-Options": "nosniff" };
const missing = () => new Response(null, { status: 404, headers });
const imageTypes = new Set(["image/jpeg", "image/png", "image/webp", "image/avif"]);
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
const MAX_ORIGINAL_BYTES = 12 * 1024 * 1024;
type PhotoCardSnapshot = Parameters<typeof getLovePassPhotoPaths>[0];

function eligibleImage(data: Blob | null, maxSize: number): data is Blob {
  return Boolean(data && imageTypes.has(data.type) && data.size > 0 && data.size <= maxSize);
}

function respondWithImage(data: Blob) {
  return new Response(data, { headers: { ...headers, "Content-Type": data.type } });
}

export async function GET(req: Request) {
  const { user } = await getRequestAuthContext(req);
  if (!user) return missing();
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("cardId") ?? "", slot = searchParams.get("slot");
  if (!/^[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/i.test(id) || (slot !== "0" && slot !== "1")) return missing();
  const rate = await checkRouteRateLimit({ requestId: crypto.randomUUID(), scope: "dating-love-pass-photo",
    path: "/api/dating/love-pass/photo", userId: user.id, ip: extractClientIp(req), userLimitPerMin: 80, ipLimitPerMin: 200 });
  if (!rate.allowed) return new Response(null, { status: 429, headers: { ...headers, "Retry-After": String(rate.retryAfterSec) } });
  const admin = createAdminClient();
  // Capture only an already-reviewed image set before checking this viewer's access.
  // Do not fetch potentially newer, unreviewed photos after the permission check.
  const { data: approved, error } = await admin.rpc("get_dating_love_pass_card_photo_snapshot", { p_card_id: id });
  if (error || !approved || typeof approved !== "object" || typeof approved.owner_user_id !== "string") return missing();
  if (!await hasLovePassNearbyCardAccess(admin, user.id, id)) return missing();
  const path = getLovePassPhotoPaths(approved as PhotoCardSnapshot)[Number(slot)];
  if (!path) return missing();
  const bucket = admin.storage.from("dating-card-photos");
  // Small originals fit the platform response budget. For historical larger
  // uploads, page through authorized derivatives before resizing the original.
  const { data, error: downloadError } = await bucket.download(path);
  if (downloadError || !eligibleImage(data, MAX_ORIGINAL_BYTES)) return missing();
  if (data.size <= MAX_RESPONSE_BYTES) return respondWithImage(data);
  if (path.includes("/raw/")) {
    const derivative = path.replace("/raw/", "/lite/").replace(/\.[^./]+$/, ".webp");
    const { data: lite, error: liteError } = await bucket.download(derivative);
    if (!liteError && eligibleImage(lite, MAX_RESPONSE_BYTES)) return respondWithImage(lite);
  }
  try {
    const sharp = (await import("sharp")).default;
    const output = await sharp(Buffer.from(await data.arrayBuffer()), { limitInputPixels: 33_000_000 })
      .rotate().resize({ width: 960, height: 960, fit: "inside", withoutEnlargement: true })
      .webp({ quality: 75 }).toBuffer();
    const resized = new Blob([Uint8Array.from(output)], { type: "image/webp" });
    return eligibleImage(resized, MAX_RESPONSE_BYTES) ? respondWithImage(resized) : missing();
  } catch { return missing(); }
}
