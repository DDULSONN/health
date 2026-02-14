import Link from "next/link";
import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { formatKstDateTime } from "@/lib/weekly";

export const metadata: Metadata = {
  title: "명예의 전당 | 짐툴 GymTools",
  description: "주간 몸짱(남/여) 선정 기록을 확인할 수 있습니다.",
};

type WinnerRow = {
  id: string;
  week_start: string;
  week_end: string;
  male_post_id: string | null;
  female_post_id: string | null;
  male_score: number;
  female_score: number;
};

export default async function HallOfFamePage() {
  const supabase = await createClient();

  const { data: winners } = await supabase
    .from("weekly_winners")
    .select("id, week_start, week_end, male_post_id, female_post_id, male_score, female_score")
    .order("week_start", { ascending: false })
    .limit(52);

  const postIds = [
    ...(winners ?? []).map((w) => w.male_post_id).filter(Boolean),
    ...(winners ?? []).map((w) => w.female_post_id).filter(Boolean),
  ] as string[];

  const postMap = new Map<string, { id: string; title: string; user_id: string }>();
  const nicknameMap = new Map<string, string | null>();

  if (postIds.length > 0) {
    const { data: posts } = await supabase
      .from("posts")
      .select("id, title, user_id")
      .in("id", postIds);
    for (const post of posts ?? []) {
      postMap.set(post.id, post);
    }

    const userIds = [...new Set((posts ?? []).map((p) => p.user_id))];
    if (userIds.length > 0) {
      const { data: profiles } = await supabase
        .from("profiles")
        .select("user_id, nickname")
        .in("user_id", userIds);
      for (const profile of profiles ?? []) {
        nicknameMap.set(profile.user_id, profile.nickname);
      }
    }
  }

  return (
    <main className="max-w-3xl mx-auto px-4 py-8">
      <div className="mb-5">
        <h1 className="text-2xl font-bold text-neutral-900">명예의 전당</h1>
        <p className="text-sm text-neutral-500 mt-1">주간 몸짱 선정 기록</p>
      </div>

      {(winners ?? []).length === 0 ? (
        <p className="text-neutral-500">아직 기록이 없습니다.</p>
      ) : (
        <div className="space-y-4">
          {(winners as WinnerRow[]).map((winner) => {
            const malePost = winner.male_post_id ? postMap.get(winner.male_post_id) ?? null : null;
            const femalePost = winner.female_post_id
              ? postMap.get(winner.female_post_id) ?? null
              : null;
            const displayEnd = new Date(new Date(winner.week_end).getTime() - 1000);

            return (
              <section key={winner.id} className="rounded-2xl border border-neutral-200 bg-white p-4">
                <p className="text-sm font-semibold text-neutral-800 mb-2">
                  {formatKstDateTime(winner.week_start)} ~ {formatKstDateTime(displayEnd)}
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <WinnerCard
                    label="남자 1위"
                    score={winner.male_score}
                    post={malePost}
                    nickname={malePost ? nicknameMap.get(malePost.user_id) ?? null : null}
                  />
                  <WinnerCard
                    label="여자 1위"
                    score={winner.female_score}
                    post={femalePost}
                    nickname={femalePost ? nicknameMap.get(femalePost.user_id) ?? null : null}
                  />
                </div>
              </section>
            );
          })}
        </div>
      )}
    </main>
  );
}

function WinnerCard({
  label,
  score,
  post,
  nickname,
}: {
  label: string;
  score: number;
  post: { id: string; title: string } | null;
  nickname: string | null;
}) {
  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
      <p className="text-xs text-amber-700 font-semibold">{label}</p>
      {post ? (
        <Link href={`/community/${post.id}`} className="block mt-1">
          <p className="text-sm font-bold text-neutral-900 truncate">{post.title}</p>
          <p className="text-xs text-neutral-600">{nickname ?? "익명"} · {score}점</p>
        </Link>
      ) : (
        <p className="text-sm text-neutral-500 mt-1">삭제된 게시글</p>
      )}
    </div>
  );
}
