import { updateSession } from "@/lib/supabase/middleware";
import type { NextRequest } from "next/server";

export async function middleware(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: [
    // 정적 파일, _next, api/og 제외
    "/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|api/og).*)",
  ],
};
