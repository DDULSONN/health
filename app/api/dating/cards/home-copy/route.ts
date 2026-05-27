import { publicCachedJson } from "@/lib/http-cache";
import { readOpenCardHomeCopy } from "@/lib/open-card-home-copy";

export async function GET() {
  const setting = await readOpenCardHomeCopy();
  return publicCachedJson(setting, { sMaxAge: 60, staleWhileRevalidate: 300 });
}
