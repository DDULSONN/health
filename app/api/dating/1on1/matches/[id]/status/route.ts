import { NextResponse } from "next/server";
import { getRequestAuthContext } from "@/lib/supabase/request";
import { createAdminClient } from "@/lib/supabase/server";
import { normalizeOneOnOneMatchId } from "@/lib/dating-1on1-match-navigation";
import { oneOnOneCurrentNotice, oneOnOneEndedNotice, oneOnOneLookupNotice } from "@/lib/dating-1on1-notification-status";

const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { user } = await getRequestAuthContext(_request);
  if (!user) return json({ error: "Unauthorized" }, 401);
  const id = normalizeOneOnOneMatchId((await params).id);
  if (!id) return json({ error: "Invalid match" }, 400);
  const admin = createAdminClient();
  // A guessed URL must never reveal another member's relationship or deletion reason.
  const result = await admin.from("dating_1on1_match_proposals")
    .select("id,state,contact_exchange_status,source_user_id,candidate_user_id")
    .eq("id", id).or(`source_user_id.eq.${user.id},candidate_user_id.eq.${user.id}`).maybeSingle();
  if (result.error) return json({ notice: oneOnOneLookupNotice() }, 503);
  if (result.data) {
    const role = result.data.source_user_id === user.id ? "source" : "candidate";
    return json({ notice: oneOnOneCurrentNotice(result.data, role) ?? {
      title: "매칭 상태를 다시 확인해 주세요", body: "이 요청의 기록은 남아 있지만 현재 화면에서 상대 프로필을 확인할 수 없어요. 목록을 새로고침해 주세요.",
    } });
  }
  // Only an owner-scoped historical notification authorizes a deleted-match explanation.
  const notice = await admin.from("notifications").select("meta_json").eq("user_id", user.id)
    .eq("meta_json->>match_id", id).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (notice.error) return json({ notice: oneOnOneLookupNotice() }, 503);
  if (!notice.data) return json({ notice: { title: "확인할 수 없는 매칭", body: "현재 계정에서 확인할 수 있는 매칭 내역이 아니에요. 알림을 받은 계정으로 로그인했는지 확인해 주세요." } }, 404);
  const meta = notice.data.meta_json;
  return json({ notice: oneOnOneEndedNotice(meta?.notification_end_reason, meta?.notification_end_role) ?? oneOnOneEndedNotice("removed") });
}
