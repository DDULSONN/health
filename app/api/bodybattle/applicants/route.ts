import { createAdminClient, createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

type EntryRow = {
  id: string;
  user_id: string;
  nickname: string;
  gender: "male" | "female";
  intro_text: string | null;
  champion_comment: string | null;
  image_url: string | null;
  rating: number;
  wins: number;
  losses: number;
  draws: number;
  exposures: number;
  votes_received: number;
  moderation_status: "pending" | "approved" | "rejected";
  status: "active" | "inactive" | "hidden";
  created_at: string;
};

type CommentRow = {
  id: string;
  entry_id: string;
  user_id: string;
  content: string | null;
  deleted_at: string | null;
  created_at: string;
};

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const seasonId = searchParams.get("season_id");
  const limitParam = Number(searchParams.get("limit") ?? 20);
  const pageParam = Number(searchParams.get("page") ?? 1);
  const limit = Number.isFinite(limitParam) ? Math.max(5, Math.min(50, Math.trunc(limitParam))) : 20;
  const page = Number.isFinite(pageParam) ? Math.max(1, Math.trunc(pageParam)) : 1;
  const offset = (page - 1) * limit;
  const admin = createAdminClient();
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const seasonBaseQuery = admin
    .from("bodybattle_seasons")
    .select("id,week_id,theme_slug,theme_label,start_at,end_at,status")
    .order("start_at", { ascending: false })
    .limit(1);
  const seasonRes = seasonId
    ? await seasonBaseQuery.eq("id", seasonId).maybeSingle()
    : await seasonBaseQuery.in("status", ["active", "closed"]).maybeSingle();

  if (seasonRes.error) {
    return NextResponse.json({ ok: false, message: seasonRes.error.message }, { status: 500 });
  }
  if (!seasonRes.data) {
    return NextResponse.json({ ok: true, season: null, items: [] });
  }

  const entriesRes = await admin
    .from("bodybattle_entries")
    .select(
      "id,user_id,nickname,gender,intro_text,champion_comment,image_url:image_urls->>0,rating,wins,losses,draws,exposures,votes_received,moderation_status,status,created_at"
    )
    .eq("season_id", seasonRes.data.id)
    .neq("moderation_status", "rejected")
    .order("created_at", { ascending: false })
    .range(offset, offset + limit);

  if (entriesRes.error) {
    return NextResponse.json({ ok: false, message: entriesRes.error.message }, { status: 500 });
  }

  const allEntries = (entriesRes.data ?? []) as EntryRow[];
  const entries = allEntries.slice(0, limit);
  const entryIds = entries.map((entry) => entry.id);

  const commentsRes =
    entryIds.length === 0
      ? { data: [], error: null }
      : await admin
          .from("bodybattle_entry_comments")
          .select("id,entry_id,user_id,content,deleted_at,created_at")
          .in("entry_id", entryIds)
          .order("created_at", { ascending: true })
          .limit(Math.max(100, Math.min(1200, limit * 30)));

  if (commentsRes.error) {
    return NextResponse.json({ ok: false, message: commentsRes.error.message }, { status: 500 });
  }

  const comments = (commentsRes.data ?? []) as CommentRow[];
  const userIds = [...new Set([...entries.map((entry) => entry.user_id), ...comments.map((comment) => comment.user_id)])];

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

  const commentsByEntry = new Map<string, Array<Record<string, unknown>>>();
  for (const comment of comments) {
    const current = commentsByEntry.get(comment.entry_id) ?? [];
    current.push({
      id: comment.id,
      user_id: comment.user_id,
      nickname: profileMap.get(comment.user_id) ?? "익명",
      content: comment.content,
      deleted_at: comment.deleted_at,
      created_at: comment.created_at,
      is_mine: comment.user_id === (user?.id ?? ""),
    });
    commentsByEntry.set(comment.entry_id, current);
  }

  const items = entries.map((entry) => ({
    ...entry,
    is_mine: entry.user_id === (user?.id ?? ""),
    user_nickname: profileMap.get(entry.user_id) ?? entry.nickname ?? "익명",
    comments: commentsByEntry.get(entry.id) ?? [],
  }));

  return NextResponse.json({
    ok: true,
    season: seasonRes.data,
    items,
    page,
    limit,
    has_more: allEntries.length > limit,
  });
}

