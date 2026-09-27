import { NextResponse } from "next/server";
import { requireAdminRoute } from "@/lib/admin-route";
import { ADMIN_CONTACT_EXCHANGE_UUID } from "@/lib/admin-contact-exchanges";
import { ensureAllowedMutationOrigin } from "@/lib/request-origin";
import { recordAdminAuditEvent } from "@/lib/admin-audit";
import { notifyDatingUser } from "@/lib/dating-notifications";

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string; matchId: string }> }) {
  const originResponse = ensureAllowedMutationOrigin(req);
  if (originResponse) return originResponse;
  const auth = await requireAdminRoute();
  if (!auth.ok) return auth.response;
  const values = await params;
  const userId = values.id.toLowerCase();
  const matchId = values.matchId.toLowerCase();
  if (!ADMIN_CONTACT_EXCHANGE_UUID.test(userId) || !ADMIN_CONTACT_EXCHANGE_UUID.test(matchId)) {
    return json({ error: "회원 및 매칭 ID를 확인해 주세요." }, 400);
  }
  const success = (alreadyClosed: boolean) => json({
    ok: true, match_id: matchId, state: "admin_canceled", contact_exchange_status: "canceled", already_closed: alreadyClosed,
  });
  try {
    const readMatch = () => auth.admin.from("dating_1on1_match_proposals")
      .select("id,source_user_id,candidate_user_id,state,contact_exchange_status,contact_exchange_note")
      .eq("id", matchId)
      .or(`source_user_id.eq.${userId},candidate_user_id.eq.${userId}`)
      .maybeSingle();
    const result = await readMatch();
    if (result.error) throw result.error;
    const row = result.data;
    if (!row) return json({ error: "이 회원의 매칭을 찾지 못했습니다. 회원을 다시 조회해 주세요." }, 404);
    if (row.state === "admin_canceled" && row.contact_exchange_status === "canceled") return success(true);
    if (row.state !== "mutual_accepted" || row.contact_exchange_status !== "approved") {
      return json({ error: "번호 교환이 완료된 매칭만 닫을 수 있습니다. 목록을 다시 조회해 주세요." }, 409);
    }

    const now = new Date().toISOString();
    // One conditional write closes both participants' access. Payment/approval history is left intact.
    const updated = await auth.admin.from("dating_1on1_match_proposals")
      .update({
        state: "admin_canceled", contact_exchange_status: "canceled", updated_at: now,
        contact_exchange_note: [row.contact_exchange_note?.trim(), `관리자 번호 교환 닫기 (${now}, admin=${auth.user.id})`].filter(Boolean).join(" | "),
      })
      .eq("id", matchId).eq("source_user_id", row.source_user_id).eq("candidate_user_id", row.candidate_user_id)
      .eq("state", "mutual_accepted").eq("contact_exchange_status", "approved")
      .select("id").maybeSingle();
    if (updated.error) throw updated.error;
    if (!updated.data) {
      const current = await readMatch();
      if (current.error) throw current.error;
      if (current.data?.state === "admin_canceled" && current.data.contact_exchange_status === "canceled") return success(true);
      return json({ error: "매칭 상태가 변경됐습니다. 목록을 다시 조회해 주세요." }, 409);
    }

    // Ancillary failures must not report a saved closure as a failed mutation or reopen it.
    await recordAdminAuditEvent({ admin: auth.admin, adminUser: auth.user, request: req,
      action: "one_on_one_contact_exchange_close", targetType: "dating_1on1_match_proposals", targetId: matchId,
      metadata: { member_user_id: userId, previous_state: row.state, previous_contact_exchange_status: row.contact_exchange_status },
    }).catch(error => console.error("[admin contact close] audit failed", error));
    await Promise.all([row.source_user_id, row.candidate_user_id].map(recipient => notifyDatingUser(auth.admin, {
      userId: recipient, actorId: auth.user.id, type: "dating_1on1_match_canceled",
      title: "1:1 번호 교환이 종료됐어요",
      body: "관리자 확인으로 해당 매칭이 종료되어 연락처가 더 이상 표시되지 않습니다.",
      route: "/mypage?section=matching&match=one_on_one",
      meta: { match_id: matchId, canceled_by: "admin", contact_exchange_closed: true },
    }))).catch(error => console.error("[admin contact close] notification failed", error));
    return success(false);
  } catch (error) {
    console.error("[admin contact close] failed", error);
    return json({ error: "처리 결과를 확인하지 못했습니다. 목록을 다시 조회해 닫힘 여부를 확인해 주세요." }, 500);
  }
}
