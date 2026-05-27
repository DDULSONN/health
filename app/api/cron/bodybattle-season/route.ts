import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({ ok: false, message: "BodyBattle is no longer available." }, { status: 410 });
}
