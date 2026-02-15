"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { timeAgo, type Post } from "@/lib/community";
import VerifiedBadge from "@/components/VerifiedBadge";

type RankingGender = "male" | "female";

type WeeklyTopItem = {
  post_id: string;
  title: string;
  user_id: string;
  images: string[];
  created_at: string;
  score_sum: number;
  vote_count: number;
  score_avg: number;
  profiles?: { nickname: string } | null;
};

type WeeklyRankingResponse = {
  week_id: string;
  gender: RankingGender;
  min_votes: number;
  items: WeeklyTopItem[];
};

export default function BodycheckBoardPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [posts, setPosts] = useState<Post[]>([]);
  const [userId, setUserId] = useState<string | null>(null);
  const [rankingGender, setRankingGender] = useState<RankingGender>("male");
  const [ranking, setRanking] = useState<WeeklyRankingResponse | null>(null);
  const [rankingLoading, setRankingLoading] = useState(true);

  const fetchFeed = useCallback(async () => {
    setLoading(true);
    try {
      const postsRes = await fetch("/api/posts?tab=photo_bodycheck&type=photo_bodycheck", {
        cache: "no-store",
      });

      if (!postsRes.ok) {
        setPosts([]);
        return;
      }

      const data = await postsRes.json();
      setPosts(data.posts ?? []);
    } catch (error) {
      console.error(error);
      setPosts([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchRanking = useCallback(async (gender: RankingGender) => {
    setRankingLoading(true);
    try {
      const res = await fetch(`/api/rankings/weekly-bodycheck?gender=${gender}&top=3`, {
        cache: "no-store",
      });

      if (!res.ok) {
        setRanking(null);
        return;
      }

      const data = (await res.json()) as WeeklyRankingResponse;
      setRanking(data);
    } catch (error) {
      console.error(error);
      setRanking(null);
    } finally {
      setRankingLoading(false);
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

  useEffect(() => {
    fetchRanking(rankingGender);
  }, [fetchRanking, rankingGender]);

  const rankingPostIds = useMemo(
    () => new Set((ranking?.items ?? []).map((item) => item.post_id)),
    [ranking]
  );

  const handleWrite = () => {
    if (!userId) {
      router.push("/login?redirect=/community/write?type=photo_bodycheck");
      return;
    }

    router.push("/community/write?type=photo_bodycheck");
  };

  const top3Items = ranking?.items ?? [];

  return (
    <main className="mx-auto max-w-2xl px-4 py-6">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-neutral-900">사진 몸평 게시판</h1>
          <p className="mt-1 text-sm text-neutral-500">사진을 공유하고 유저 평가를 받아보세요.</p>
        </div>
        <button
          type="button"
          onClick={handleWrite}
          className="min-h-[44px] rounded-xl bg-indigo-600 px-4 text-sm font-semibold text-white transition hover:bg-indigo-700 active:scale-[0.98]"
        >
          글쓰기
        </button>
      </div>

      <section className="mb-5 rounded-2xl border border-amber-200 bg-amber-50 p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-bold text-amber-800">이번주 몸짱 TOP3</p>
            <p className="mt-1 text-xs text-amber-700">
              {ranking?.week_id ? `${ranking.week_id} 집계` : "이번주 집계"}
            </p>
          </div>
          <Link href="/hall-of-fame" className="text-xs text-amber-700 hover:underline">
            명예의 전당
          </Link>
        </div>

        <div className="mt-3 grid grid-cols-2 overflow-hidden rounded-xl border border-amber-200 bg-white">
          <button
            type="button"
            onClick={() => setRankingGender("male")}
            className={`min-h-[42px] text-sm font-medium ${
              rankingGender === "male" ? "bg-amber-600 text-white" : "text-amber-800"
            }`}
          >
            남자
          </button>
          <button
            type="button"
            onClick={() => setRankingGender("female")}
            className={`min-h-[42px] text-sm font-medium ${
              rankingGender === "female" ? "bg-amber-600 text-white" : "text-amber-800"
            }`}
          >
            여자
          </button>
        </div>

        {rankingLoading ? (
          <p className="mt-3 text-xs text-neutral-500">랭킹 불러오는 중...</p>
        ) : top3Items.length === 0 ? (
          <p className="mt-3 text-sm text-neutral-600">
            랭킹 집계중입니다. 최소 {ranking?.min_votes ?? 5}표 이상부터 노출됩니다.
          </p>
        ) : (
          <div className="mt-3 space-y-2">
            {top3Items.map((item, idx) => (
              <Link
                key={item.post_id}
                href={`/community/${item.post_id}`}
                className="block rounded-xl border border-amber-200 bg-white p-3"
              >
                <p className="text-xs font-semibold text-amber-700">TOP {idx + 1}</p>
                <p className="truncate text-sm font-semibold text-neutral-900">{item.title}</p>
                <p className="mt-1 text-xs text-neutral-600">
                  {item.profiles?.nickname ?? "익명"} · 평균 {item.score_avg.toFixed(2)} / {item.vote_count}표
                </p>
              </Link>
            ))}
          </div>
        )}
      </section>

      <div className="mb-3">
        <Link href="/community" className="text-sm text-neutral-500 hover:text-neutral-700">
          ← 커뮤니티 메인
        </Link>
      </div>

      <section className="space-y-3">
        {loading ? (
          <p className="py-12 text-center text-neutral-400">불러오는 중...</p>
        ) : posts.length === 0 ? (
          <p className="py-12 text-center text-neutral-400">아직 사진 몸평 게시글이 없습니다.</p>
        ) : (
          posts.map((post) => {
            const voteCount = Number(post.vote_count ?? 0);
            const scoreSum = Number(post.score_sum ?? 0);
            const avg = voteCount > 0 ? (scoreSum / voteCount).toFixed(2) : "0.00";
            const isTop = rankingPostIds.has(post.id);

            return (
              <Link
                key={post.id}
                href={`/community/${post.id}`}
                className="block rounded-2xl border border-neutral-200 bg-white p-3 transition active:scale-[0.99]"
              >
                <div className="flex gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-medium text-indigo-700">
                        사진 몸평 · {post.gender === "female" ? "여성" : "남성"}
                      </span>
                      {isTop && (
                        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700">
                          TOP3
                        </span>
                      )}
                      <span className="text-xs text-neutral-400">{timeAgo(post.created_at)}</span>
                    </div>
                    <h2 className="mt-1 truncate text-sm font-semibold text-neutral-900">{post.title}</h2>
                    {post.content && <p className="mt-1 line-clamp-2 text-xs text-neutral-600">{post.content}</p>}
                    <p className="mt-1 text-xs text-indigo-700">
                      평균 {avg} / 투표 {voteCount}
                    </p>
                    <div className="mt-1 flex items-center gap-2">
                      <p className="text-xs text-neutral-500">작성자 {post.profiles?.nickname ?? "닉네임 없음"}</p>
                      <VerifiedBadge total={post.cert_summary?.total} />
                    </div>
                  </div>
                  {(post.images?.length ?? 0) > 0 && (
                    <img
                      src={post.images?.[0]}
                      alt=""
                      className="h-20 w-20 shrink-0 rounded-xl border border-neutral-100 object-cover"
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
