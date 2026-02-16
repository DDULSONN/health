import { createClient, createAdminClient } from "@/lib/supabase/server";
import { containsProfanity, containsContactInfo, getRateLimitRemaining } from "@/lib/moderation";
import { NextResponse } from "next/server";

const COMMENT_COOLDOWN_MS = 10_000;

/** POST /api/dating/comments — 소개팅 카드에 댓글 작성 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  if (!body) {
    return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });
  }

  const applicationId = (body.application_id as string)?.trim();
  const content = (body.content as string)?.trim();

  if (!applicationId || !content) {
    return NextResponse.json({ error: "내용을 입력해 주세요." }, { status: 400 });
  }

  if (content.length > 500) {
    return NextResponse.json({ error: "댓글은 500자 이하로 입력해주세요." }, { status: 400 });
  }

  if (containsProfanity(content)) {
    return NextResponse.json({ error: "부적절한 표현이 포함되어 있습니다." }, { status: 400 });
  }

  if (containsContactInfo(content)) {
    return NextResponse.json({ error: "연락처/SNS 정보는 댓글에 입력할 수 없습니다." }, { status: 400 });
  }

  const adminClient = createAdminClient();

  // 공개 카드 확인
  const { data: app } = await adminClient
    .from("dating_applications")
    .select("id")
    .eq("id", applicationId)
    .eq("approved_for_public", true)
    .not("thumb_blur_path", "is", null)
    .maybeSingle();

  if (!app) {
    return NextResponse.json({ error: "댓글을 달 수 없는 카드입니다." }, { status: 404 });
  }

  // Rate limit
  const { data: lastComment } = await adminClient
    .from("dating_comments")
    .select("created_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const remaining = getRateLimitRemaining(lastComment?.created_at ?? null, COMMENT_COOLDOWN_MS);
  if (remaining > 0) {
    return NextResponse.json(
      { error: `${Math.ceil(remaining / 1000)}초 후에 다시 시도해 주세요.` },
      { status: 429 }
    );
  }

  const { data, error } = await adminClient
    .from("dating_comments")
    .insert({
      application_id: applicationId,
      user_id: user.id,
      content,
    })
    .select("id")
    .single();

  if (error) {
    console.error("[POST /api/dating/comments]", error.message);
    return NextResponse.json({ error: "댓글 작성에 실패했습니다." }, { status: 500 });
  }

  return NextResponse.json({ id: data.id }, { status: 201 });
}
