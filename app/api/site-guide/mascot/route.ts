import { publicCachedJson } from "@/lib/http-cache";
import { readSiteGuideMascotSetting } from "@/lib/site-guide-mascot";

export async function GET() {
  return publicCachedJson(await readSiteGuideMascotSetting(), {
    sMaxAge: 60,
    staleWhileRevalidate: 300,
  });
}
