"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { timeAgo, type Post } from "@/lib/community";
import { formatKstDateTime } from "@/lib/weekly";

type WeeklyTopItem = {
  id: string;
  title: string;
  score_sum: number;
  vote_count: number;
  profiles?: { nickname: string | null } | null;
};

type LatestWeeklyResponse =
  | {
      mode: "confirmed";
      week: { start_utc: string; end_utc: string };
      male: { post_id: string; score: number; post: WeeklyTopItem | null } | null;
      female: { post_id: string; score: number; post: WeeklyTopItem | null } | null;
    }
  | {
      mode: "collecting";
      week: { start_utc: string; end_utc: string };
      male: WeeklyTopItem | null;
      female: WeeklyTopItem | null;
    };

export default function BodycheckBoardPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [posts, setPosts] = useState<Post[]>([]);
  const [latest, setLatest] = useState<LatestWeeklyResponse | null>(null);
  const [userId, setUserId] = useState<string | null>(null);

  const fetchFeed = useCallback(async () => {
    setLoading(true);
    try {
      const [postsRes, latestRes] = await Promise.all([
        fetch("/api/posts?tab=photo_bodycheck&type=photo_bodycheck", { cache: "no-store" }),
        fetch("/api/weekly-winners/latest", { cache: "no-store" }),
      ]);

      if (postsRes.ok) {
        const data = await postsRes.json();
        setPosts(data.posts ?? []);
      } else {
        setPosts([]);
      }

      if (latestRes.ok) {
        const data = (await latestRes.json()) as LatestWeeklyResponse;
        setLatest(data);
      } else {
        setLatest(null);
      }
    } catch (error) {
      console.error(error);
      setPosts([]);
      setLatest(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    createClient()
      .auth.getUser()
      .then(({ data: { user } }) => {
        setUserId(user?.id ?? null);
      });
    fetchFeed();
  }, [fetchFeed]);

  const winnerIds = useMemo(() => {
    if (!latest) return new Set<string>();
    const ids: string[] = [];
    if (latest.mode === "confirmed") {
      if (latest.male?.post_id) ids.push(latest.male.post_id);
      if (latest.female?.post_id) ids.push(latest.female.post_id);
    }
    return new Set(ids);
  }, [latest]);

  const handleWrite = () => {
    if (!userId) {
      router.push("/login?redirect=/community/write?type=photo_bodycheck");
      return;
    }
    router.push("/community/write?type=photo_bodycheck");
  };

  return (
    <main className="max-w-2xl mx-auto px-4 py-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl font-bold text-neutral-900">사진 몸평 게시판</h1>
          <p className="text-sm text-neutral-500 mt-1">사진과 글을 올리고 유저들의 평가를 받아보세요.</p>
        </div>
        <button
          type="button"
          onClick={handleWrite}
          className="min-h-[44px] px-4 rounded-xl bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 active:scale-[0.98] transition"
        >
          글쓰기
        </button>
      </div>

      <section className="rounded-2xl border border-amber-200 bg-amber-50 p-4 mb-5">
        <div className="flex items-center justify-between">
          <p className="text-sm font-bold text-amber-800">🔥 이번주 몸짱</p>
          <Link href="/hall-of-fame" className="text-xs text-amber-700 hover:underline">
            명예의 전당
          </Link>
        </div>
        {latest ? (
          <p className="text-xs text-neutral-600 mt-1">
            {latest.mode === "collecting" ? "이번주 집계중" : "확정 주차"} · {formatKstDateTime(latest.week.start_utc)} ~{" "}
            {formatKstDateTime(latest.week.end_utc)}
          </p>
        ) : (
          <p className="text-xs text-neutral-600 mt-1">이번주 1위가 아직 없습니다.</p>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-3">
          <WeeklyWinnerCard
            label="남자 1위"
            item={
              latest?.mode === "confirmed"
                ? latest.male?.post
                  ? {
                      ...(latest.male.post as WeeklyTopItem),
                      score_sum: latest.male.score,
                    }
                  : null
                : latest?.male ?? null
            }
          />
          <WeeklyWinnerCard
            label="여자 1위"
            item={
              latest?.mode === "confirmed"
                ? latest.female?.post
                  ? {
                      ...(latest.female.post as WeeklyTopItem),
                      score_sum: latest.female.score,
                    }
                  : null
                : latest?.female ?? null
            }
          />
        </div>
      </section>

      <div className="mb-3">
        <Link href="/community" className="text-sm text-neutral-500 hover:text-neutral-700">
          ← 커뮤니티 메인
        </Link>
      </div>

      <section className="space-y-3">
        {loading ? (
          <p className="text-neutral-400 text-center py-12">불러오는 중...</p>
        ) : posts.length === 0 ? (
          <p className="text-neutral-400 text-center py-12">아직 사진 몸평 게시글이 없습니다.</p>
        ) : (
          posts.map((post) => {
            const voteCount = Number(post.vote_count ?? 0);
            const scoreSum = Number(post.score_sum ?? 0);
            const avg = voteCount > 0 ? (scoreSum / voteCount).toFixed(2) : "0.00";
            const isWeeklyWinner = winnerIds.has(post.id);

            return (
              <Link
                key={post.id}
                href={`/community/${post.id}`}
                className="block rounded-2xl border border-neutral-200 bg-white p-3 active:scale-[0.99] transition"
              >
                <div className="flex gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-indigo-100 text-indigo-700">
                        사진 몸평 · {post.gender === "female" ? "여성" : "남성"}
                      </span>
                      {isWeeklyWinner && (
                        <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-700">
                          🏆 이번주 몸짱
                        </span>
                      )}
                      <span className="text-xs text-neutral-400">{timeAgo(post.created_at)}</span>
                    </div>
                    <h2 className="mt-1 text-sm font-semibold text-neutral-900 truncate">{post.title}</h2>
                    {post.content && <p className="text-xs text-neutral-600 mt-1 line-clamp-2">{post.content}</p>}
                    <p className="text-xs text-indigo-700 mt-1">평균 {avg} / 투표 {voteCount}</p>
                    <p className="text-xs text-neutral-500 mt-1">작성자 {post.profiles?.nickname ?? "닉네임 없음"}</p>
                  </div>
                  {(post.images?.length ?? 0) > 0 && (
                    <img
                      src={post.images?.[0]}
                      alt=""
                      className="w-20 h-20 rounded-xl object-cover border border-neutral-100 shrink-0"
                    />
                  )}
                </div>
              </Link>
            );
          })
        )}
      </section>
    </main>
  );
}

function WeeklyWinnerCard({
  label,
  item,
}: {
  label: string;
  item: WeeklyTopItem | null;
}) {
  if (!item) {
    return (
      <div className="rounded-xl border border-neutral-200 bg-white p-3">
        <p className="text-xs text-neutral-500">{label}</p>
        <p className="text-sm text-neutral-400 mt-1">아직 없습니다.</p>
      </div>
    );
  }

  return (
    <Link href={`/community/${item.id}`} className="block rounded-xl border border-amber-200 bg-white p-3">
      <p className="text-xs text-amber-700 font-semibold">{label}</p>
      <p className="text-sm text-neutral-900 font-semibold truncate">{item.title}</p>
      <p className="text-xs text-neutral-600">
        {item.profiles?.nickname ?? "익명"} · {item.score_sum}점
      </p>
    </Link>
  );
}
