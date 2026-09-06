import { NextResponse } from "next/server";
import { requireAdminRoute } from "@/lib/admin-route";

export async function GET() {
  const auth = await requireAdminRoute();
  if (!auth.ok) return auth.response;

  const postsRes = await auth.admin.from("posts").select("*")
    .order("created_at", { ascending: false }).limit(50);
  if (postsRes.error) {
    return NextResponse.json({ error: "게시글을 불러오지 못했습니다." }, { status: 500 });
  }
  const posts = postsRes.data ?? [];
  const userIds = [...new Set(posts.map((post) => String(post.user_id)))];
  const profilesRes = userIds.length
    ? await auth.admin.from("profiles").select("user_id,nickname").in("user_id", userIds)
    : { data: [], error: null };
  if (profilesRes.error) {
    return NextResponse.json({ error: "작성자 정보를 불러오지 못했습니다." }, { status: 500 });
  }
  const names = new Map((profilesRes.data ?? []).map((profile) => [profile.user_id, profile.nickname]));
  return NextResponse.json({ posts: posts.map((post) => ({
    ...post,
    profiles: names.has(post.user_id) ? { nickname: names.get(post.user_id) } : null,
  })) }, { headers: { "Cache-Control": "private, no-store" } });
}
