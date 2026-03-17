import { NextResponse } from "next/server";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { getConfirmedActiveUserOrResponse } from "@/lib/auth-active";

type ReportTargetType = "post" | "comment";

function isValidTargetType(value: unknown): value is ReportTargetType {
  return value === "post" || value === "comment";
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const guard = await getConfirmedActiveUserOrResponse(supabase);
  if (guard.response) return guard.response;
  const user = guard.user;
  if (!user) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }

  const body = (await request.json()) as {
    target_type?: ReportTargetType;
    target_id?: string;
    reason?: string;
  };

  if (!isValidTargetType(body.target_type) || !body.target_id?.trim() || !body.reason?.trim()) {
    return NextResponse.json({ error: "신고 대상과 사유를 입력해 주세요." }, { status: 400 });
  }

  const admin = createAdminClient();
  const targetId = body.target_id.trim();
  const reason = body.reason.trim();

  const targetQuery =
    body.target_type === "post"
      ? admin.from("posts").select("id,user_id,is_deleted").eq("id", targetId).maybeSingle()
      : admin.from("comments").select("id,user_id,deleted_at").eq("id", targetId).maybeSingle();

  const { data: target, error: targetError } = await targetQuery;
  if (targetError || !target) {
    return NextResponse.json({ error: "신고 대상을 찾을 수 없습니다." }, { status: 404 });
  }

  if (target.user_id === user.id) {
    return NextResponse.json({ error: "본인 글이나 댓글은 신고할 수 없습니다." }, { status: 400 });
  }

  if ((body.target_type === "post" && Boolean((target as { is_deleted?: boolean }).is_deleted)) || (body.target_type === "comment" && Boolean((target as { deleted_at?: string | null }).deleted_at))) {
    return NextResponse.json({ error: "이미 삭제된 항목은 신고할 수 없습니다." }, { status: 400 });
  }

  const { data: existingReport, error: existingError } = await admin
    .from("reports")
    .select("id")
    .eq("target_type", body.target_type)
    .eq("target_id", targetId)
    .eq("reporter_id", user.id)
    .maybeSingle();

  if (existingError) {
    return NextResponse.json({ error: "신고 상태를 확인하지 못했습니다." }, { status: 500 });
  }

  if (existingReport) {
    return NextResponse.json({ error: "이미 신고한 항목입니다." }, { status: 409 });
  }

  const { error } = await admin.from("reports").insert({
    target_type: body.target_type,
    target_id: targetId,
    reporter_id: user.id,
    reason,
    resolved: false,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const countRes = await admin
    .from("reports")
    .select("id", { count: "exact", head: true })
    .eq("target_type", body.target_type)
    .eq("target_id", targetId)
    .eq("resolved", false);

  return NextResponse.json(
    {
      ok: true,
      target_type: body.target_type,
      target_id: targetId,
      unresolved_count: Number(countRes.count ?? 0),
    },
    { status: 201 }
  );
}
