import { NextResponse } from "next/server";
import { readAdInquirySetting } from "@/lib/ad-inquiry";

export async function GET() {
  const setting = await readAdInquirySetting();
  return NextResponse.json(setting, {
    headers: {
      "Cache-Control": "public, max-age=0, s-maxage=300, stale-while-revalidate=600",
      "CDN-Cache-Control": "public, s-maxage=300, stale-while-revalidate=600",
      "Vercel-CDN-Cache-Control": "public, s-maxage=300, stale-while-revalidate=600",
    },
  });
}
