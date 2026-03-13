import type { DatingOneOnOneMatchRow } from "@/lib/dating-1on1";
import { getDatingOneOnOneCardsByIds } from "@/lib/dating-1on1";
import { createAdminClient } from "@/lib/supabase/server";
import { getRequestAuthContext } from "@/lib/supabase/request";
import { NextResponse } from "next/server";

export async function GET(req: Request) {
  const { user } = await getRequestAuthContext(req);

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("dating_1on1_match_proposals")
    .select(
      "id,source_card_id,source_user_id,candidate_card_id,candidate_user_id,state,admin_sent_by_user_id,source_selected_at,candidate_responded_at,source_final_responded_at,created_at,updated_at"
    )
    .or(`source_user_id.eq.${user.id},candidate_user_id.eq.${user.id}`)
    .order("created_at", { ascending: false })
    .limit(200);

  if (error) {
    console.error("[GET /api/dating/1on1/matches/my] failed", error);
    return NextResponse.json({ error: "Failed to load match proposals." }, { status: 500 });
  }

  const rows = (data ?? []) as DatingOneOnOneMatchRow[];
  const cardMap = await getDatingOneOnOneCardsByIds(
    admin,
    rows.flatMap((row) => [row.source_card_id, row.candidate_card_id])
  ).catch((cardError) => {
    console.error("[GET /api/dating/1on1/matches/my] cards failed", cardError);
    return null;
  });

  if (!cardMap) {
    return NextResponse.json({ error: "Failed to load card details." }, { status: 500 });
  }

  return NextResponse.json({
    items: rows.map((row) => {
      const role = row.source_user_id === user.id ? "source" : "candidate";
      const counterpartyCardId = role === "source" ? row.candidate_card_id : row.source_card_id;
      return {
        ...row,
        role,
        source_card: cardMap.get(row.source_card_id) ?? null,
        candidate_card: cardMap.get(row.candidate_card_id) ?? null,
        counterparty_card: cardMap.get(counterpartyCardId) ?? null,
        action_required:
          (role === "source" && (row.state === "proposed" || row.state === "candidate_accepted")) ||
          (role === "candidate" && row.state === "source_selected"),
      };
    }),
  });
}
