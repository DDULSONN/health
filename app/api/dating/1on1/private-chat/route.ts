import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { getRequestAuthContext } from "@/lib/supabase/request";
import { ensureAllowedMutationOrigin } from "@/lib/request-origin";
import { privateContactContext } from "@/lib/dating-private-contact-server";

const headers = { "Cache-Control": "private, no-store", Vary: "Cookie, Authorization" };
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
async function handle(request: Request, write: boolean, read = false) {
  if (write) { const blocked = ensureAllowedMutationOrigin(request); if (blocked) return blocked; }
  const context = await getRequestAuthContext(request).catch(() => null);
  if (!context) return NextResponse.json({ error: "로그인 상태를 확인하지 못했어요. 잠시 후 다시 확인해 주세요." }, { status: 503, headers });
  const { user } = context;
  if (!user || user.deleted_at) return NextResponse.json({ error: "로그인이 필요해요." }, { status: 401, headers });
  const input = write ? await request.json().catch(() => null) : Object.fromEntries(new URL(request.url).searchParams);
  if (!input || typeof input.matchId !== "string" || !uuid.test(input.matchId) || (read &&
    (typeof input.through !== "string" || !/^[1-9][0-9]{0,18}$/.test(input.through))) || (write && !read &&
    (typeof input.content !== "string" || !input.content.trim() || input.content.length > 1000 || !uuid.test(String(input.clientId ?? ""))))) {
    return NextResponse.json({ error: "보낼 내용을 확인해 주세요." }, { status: 400, headers });
  }
  try {
    const admin = createAdminClient();
    // Establish membership BEFORE looking up the payer's Instagram.
    const pair = await admin.from("dating_1on1_match_proposals").select("source_user_id,candidate_user_id")
      .eq("id", input.matchId).maybeSingle();
    if (pair.error) throw pair.error;
    if (!pair.data || ![pair.data.source_user_id, pair.data.candidate_user_id].includes(user.id)) throw new Error("PRIVATE_UNAVAILABLE");
    const disclosure = await admin.from("dating_1on1_private_contacts").select("instagram,payer_user_id")
      .eq("match_id", input.matchId).maybeSingle();
    if (disclosure.error || !disclosure.data) throw new Error("PRIVATE_UNAVAILABLE");
    // Block hashes belong to the payer even when the recipient opens this chat.
    const params = await privateContactContext(admin, input.matchId, disclosure.data.payer_user_id, disclosure.data.instagram);
    if (read) {
      const result = await admin.rpc("read_private_chat", { ...params, p_user: user.id, p_through: input.through });
      if (result.error) throw result.error;
      return NextResponse.json(result.data, { headers });
    }
    const { data, error } = await admin.rpc("private_contact_messages", { ...params, p_user: user.id,
      p_content: write ? input.content.trim() : null, p_client_id: write ? input.clientId : null });
    if (error) throw error;
    return NextResponse.json({ items: data ?? [] }, { headers });
  } catch (error) {
    if (error && typeof error === "object" && "message" in error && String(error.message).includes("PRIVATE_RATE_LIMIT")) {
      return NextResponse.json({ error: "메시지를 빠르게 여러 번 보냈어요. 잠시 후 다시 보내 주세요." }, { status: 429, headers: { ...headers, "Retry-After": "60" } });
    }
    return NextResponse.json({ error: "채팅을 확인하지 못했어요. 잠시 후 다시 확인해 주세요. 매칭 취소·차단 후에는 이용할 수 없어요." }, { status: 409, headers });
  }
}
export const GET = (request: Request) => handle(request, false);
export const POST = (request: Request) => handle(request, true);
export const PATCH = (request: Request) => handle(request, true, true);
