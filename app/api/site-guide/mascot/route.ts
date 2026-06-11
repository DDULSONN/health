import { NextResponse } from "next/server";
import { readSiteGuideMascotSetting } from "@/lib/site-guide-mascot";

export async function GET() {
  return NextResponse.json(await readSiteGuideMascotSetting());
}
