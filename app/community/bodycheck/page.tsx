"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { timeAgo, type Post } from "@/lib/community";

type WeeklyTopItem = {
  id: string;
  title: string;
  images: string[] | null;
  score_sum: number;
  vote_count: number;
  average_score: number;
  profiles: { nickname: string } | null;
};

export default function BodycheckBoardPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [posts, setPosts] = useState<Post[]>([]);
  const [maleTop, setMaleTop] = useState<WeeklyTopItem | null>(null);
  const [femaleTop, setFemaleTop] = useState<WeeklyTopItem | null>(null);
  const [userId, setUserId] = useState<string | null>(null);

  const fetchFeed = useCallback(async () => {
    setLoading(true);
    try {
      const [postsRes, maleRes, femaleRes] = await Promise.all([
        fetch("/api/posts?tab=photo_bodycheck&type=photo_bodycheck"),
        fetch("/api/rankings/weekly-bodycheck?gender=male"),
        fetch("/api/rankings/weekly-bodycheck?gender=female"),
      ]);

      if (postsRes.ok) {
        const data = await postsRes.json();
        setPosts(data.posts ?? []);
      } else {
        setPosts([]);
      }

      if (maleRes.ok) {
        const data = await maleRes.json();
        setMaleTop((data.items?.[0] ?? null) as WeeklyTopItem | null);
      }

      if (femaleRes.ok) {
        const data = await femaleRes.json();
        setFemaleTop((data.items?.[0] ?? null) as WeeklyTopItem | null);
      }
    } catch (error) {
      console.error(error);
      setPosts([]);
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

  const emptyState = useMemo(
    () => (
      <p className="text-neutral-400 text-center py-12">
        아직 사진 몸평 게시글이 없습니다.
      </p>
    ),
    []
  );

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
          <p className="text-sm text-neutral-500 mt-1">
            사진+짧은 글을 올리고 4단계 평가를 받아보세요.
          </p>
        </div>
        <button
          type="button"
          onClick={handleWrite}
          className="min-h-[44px] px-4 rounded-xl bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 active:scale-[0.98] transition"
        >
          글쓰기
        </button>
      </div>

      <div className="rounded-2xl border border-indigo-200 bg-indigo-50 p-4 mb-4 text-sm text-indigo-800">
        이 게시판은 평가를 받는 공간입니다. 본인 글에는 평가할 수 없습니다.
      </div>

      <section className="grid grid-cols-1 gap-3 mb-5 sm:grid-cols-2">
        <WeeklyWinnerCard genderLabel="이번주 몸짱(남)" item={maleTop} />
        <WeeklyWinnerCard genderLabel="이번주 몸짱(여)" item={femaleTop} />
      </section>

      <div className="mb-3">
        <Link
          href="/community"
          className="text-sm text-neutral-500 hover:text-neutral-700"
        >
          ← 커뮤니티 메인
        </Link>
      </div>

      <section className="space-y-3">
        {loading ? (
          <p className="text-neutral-400 text-center py-12">로딩 중...</p>
        ) : posts.length === 0 ? (
          emptyState
        ) : (
          posts.map((post) => {
            const voteCount = Number(post.vote_count ?? 0);
            const scoreSum = Number(post.score_sum ?? 0);
            const avg = voteCount > 0 ? (scoreSum / voteCount).toFixed(2) : "0.00";

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
                      <span className="text-xs text-neutral-400">
                        {timeAgo(post.created_at)}
                      </span>
                    </div>
                    <h2 className="mt-1 text-sm font-semibold text-neutral-900 truncate">
                      {post.title}
                    </h2>
                    {post.content && (
                      <p className="text-xs text-neutral-600 mt-1 line-clamp-2">
                        {post.content}
                      </p>
                    )}
                    <p className="text-xs text-indigo-700 mt-1">
                      평균 {avg} / 투표 {voteCount}
                    </p>
                    <p className="text-xs text-neutral-500 mt-1">
                      작성자: {post.profiles?.nickname ?? "알 수 없음"}
                    </p>
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
  genderLabel,
  item,
}: {
  genderLabel: string;
  item: WeeklyTopItem | null;
}) {
  if (!item) {
    return (
      <div className="rounded-2xl border border-neutral-200 bg-white p-4 min-h-[130px]">
        <p className="text-xs font-semibold text-neutral-500">{genderLabel}</p>
        <p className="text-sm text-neutral-400 mt-3">아직 선정된 게시글이 없습니다.</p>
      </div>
    );
  }

  return (
    <Link
      href={`/community/${item.id}`}
      className="block rounded-2xl border border-amber-200 bg-gradient-to-br from-amber-50 to-white p-4 min-h-[130px] active:scale-[0.99] transition"
    >
      <p className="text-xs font-semibold text-amber-700">{genderLabel}</p>
      <p className="text-sm font-bold text-neutral-900 mt-1 truncate">{item.title}</p>
      <p className="text-xs text-neutral-600 mt-1">
        {item.profiles?.nickname ?? "익명"} · 평균 {item.average_score.toFixed(2)} · 투표{" "}
        {item.vote_count}
      </p>
    </Link>
  );
}
