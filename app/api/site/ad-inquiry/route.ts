import { NextResponse } from "next/server";
import { readAdInquirySetting } from "@/lib/ad-inquiry";

export async function GET() {
  const setting = await readAdInquirySetting();
  return NextResponse.json(setting, {
    headers: {
      "Cache-Control": "no-store, max-age=0",
      "CDN-Cache-Control": "no-store",
      "Vercel-CDN-Cache-Control": "no-store",
    },
  });
}
