import { isAllowedAdminUser } from "@/lib/admin";
import { containsContactInfo, containsProfanity, getRateLimitRemaining } from "@/lib/moderation";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

const COMMENT_COOLDOWN_MS = 10_000;

type CreateCommentBody = {
  entry_id?: string;
  content?: string;
};

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ ok: false, message: "Login is required." }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as CreateCommentBody;
  const entryId = (body.entry_id ?? "").trim();
  const content = (body.content ?? "").trim();

  if (!entryId || !content) {
    return NextResponse.json({ ok: false, message: "entry_id and content are required." }, { status: 400 });
  }
  if (content.length > 500) {
    return NextResponse.json({ ok: false, message: "Comment must be 500 chars or less." }, { status: 400 });
  }
  if (containsProfanity(content)) {
    return NextResponse.json({ ok: false, message: "Comment contains blocked words." }, { status: 400 });
  }
  if (containsContactInfo(content)) {
    return NextResponse.json({ ok: false, message: "Contact info is not allowed." }, { status: 400 });
  }

  const admin = createAdminClient();
  const entryRes = await admin
    .from("bodybattle_entries")
    .select("id,moderation_status,status")
    .eq("id", entryId)
    .limit(1)
    .maybeSingle();
  if (entryRes.error) {
    return NextResponse.json({ ok: false, message: entryRes.error.message }, { status: 500 });
  }
  if (!entryRes.data) {
    return NextResponse.json({ ok: false, message: "Entry not found." }, { status: 404 });
  }
  if (entryRes.data.status === "hidden" || entryRes.data.moderation_status === "rejected") {
    return NextResponse.json({ ok: false, message: "Commenting is not available for this entry." }, { status: 400 });
  }

  const lastCommentRes = await admin
    .from("bodybattle_entry_comments")
    .select("created_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (lastCommentRes.error) {
    return NextResponse.json({ ok: false, message: lastCommentRes.error.message }, { status: 500 });
  }

  const remaining = getRateLimitRemaining(lastCommentRes.data?.created_at ?? null, COMMENT_COOLDOWN_MS);
  if (remaining > 0) {
    return NextResponse.json(
      { ok: false, message: `Please retry in ${Math.ceil(remaining / 1000)}s.` },
      { status: 429 }
    );
  }

  const insertRes = await admin
    .from("bodybattle_entry_comments")
    .insert({
      entry_id: entryId,
      user_id: user.id,
      content,
    })
    .select("id,entry_id,user_id,content,deleted_at,created_at")
    .single();

  if (insertRes.error) {
    return NextResponse.json({ ok: false, message: insertRes.error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, comment: insertRes.data }, { status: 201 });
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const entryId = (searchParams.get("entry_id") ?? "").trim();
  const limit = Math.max(1, Math.min(100, Number(searchParams.get("limit") ?? 50)));

  if (!entryId) {
    return NextResponse.json({ ok: false, message: "entry_id is required." }, { status: 400 });
  }

  const admin = createAdminClient();
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const commentsRes = await admin
    .from("bodybattle_entry_comments")
    .select("id,entry_id,user_id,content,deleted_at,created_at")
    .eq("entry_id", entryId)
    .order("created_at", { ascending: true })
    .limit(limit);
  if (commentsRes.error) {
    return NextResponse.json({ ok: false, message: commentsRes.error.message }, { status: 500 });
  }

  const comments = commentsRes.data ?? [];
  const userIds = [...new Set(comments.map((comment) => comment.user_id).filter(Boolean))];
  const profilesRes =
    userIds.length === 0
      ? { data: [], error: null }
      : await admin.from("profiles").select("user_id,nickname").in("user_id", userIds);
  if (profilesRes.error) {
    return NextResponse.json({ ok: false, message: profilesRes.error.message }, { status: 500 });
  }

  const profileMap = new Map<string, string>();
  for (const profile of profilesRes.data ?? []) {
    if (profile.user_id) profileMap.set(profile.user_id, profile.nickname ?? "익명");
  }

  return NextResponse.json({
    ok: true,
    items: comments.map((comment) => ({
      ...comment,
      nickname: profileMap.get(comment.user_id) ?? "익명",
      is_mine: comment.user_id === (user?.id ?? ""),
    })),
    is_admin: isAllowedAdminUser(user?.id ?? null, user?.email ?? null),
  });
}
