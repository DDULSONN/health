import { readAdInquirySetting } from "@/lib/ad-inquiry";
import { publicCachedJson } from "@/lib/http-cache";

export async function GET() {
  const setting = await readAdInquirySetting();
  return publicCachedJson(setting, { sMaxAge: 60, staleWhileRevalidate: 300 });
}
