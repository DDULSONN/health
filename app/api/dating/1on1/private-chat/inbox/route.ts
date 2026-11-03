import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { getRequestAuthContext } from "@/lib/supabase/request";
import { loadPrivateChatInbox } from "@/lib/private-chat-inbox";

const headers = { "Cache-Control": "private, no-store", Vary: "Cookie, Authorization" };
export async function GET(request: Request) {
  try {
    const { user } = await getRequestAuthContext(request);
    if (!user || user.deleted_at) return NextResponse.json({ error: "로그인이 필요해요." }, { status: 401, headers });
    const items = await loadPrivateChatInbox(createAdminClient(), user.id);
    return NextResponse.json({ items }, { headers });
  } catch {
    return NextResponse.json({ error: "1:1 대화 목록을 불러오지 못했어요. 다시 확인해 주세요." }, { status: 503, headers });
  }
}
