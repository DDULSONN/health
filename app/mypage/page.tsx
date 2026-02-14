"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { timeAgo } from "@/lib/community";

type BodycheckPost = {
  id: string;
  title: string;
  created_at: string;
  score_sum: number;
  vote_count: number;
  average_score: number;
  images: string[] | null;
};

type SummaryResponse = {
  profile: {
    nickname: string | null;
    email: string | null;
  };
  weekly_win_count: number;
  bodycheck_posts: BodycheckPost[];
};

export default function MyPage() {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);

  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState<SummaryResponse | null>(null);
  const [error, setError] = useState("");
  const [loggingOut, setLoggingOut] = useState(false);

  useEffect(() => {
    let isMounted = true;

    (async () => {
      try {
        const {
          data: { user },
        } = await supabase.auth.getUser();

        if (!user) {
          router.replace("/login?redirect=/mypage");
          return;
        }

        const res = await fetch("/api/mypage/summary", { cache: "no-store" });
        const data = await res.json();

        if (!res.ok) {
          throw new Error(data.error ?? "마이페이지 정보를 불러오지 못했습니다.");
        }

        if (isMounted) {
          setSummary(data as SummaryResponse);
          setError("");
        }
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        if (isMounted) setError(message);
      } finally {
        if (isMounted) setLoading(false);
      }
    })();

    return () => {
      isMounted = false;
    };
  }, [router, supabase]);

  const handleLogout = async () => {
    if (loggingOut) return;
    setLoggingOut(true);
    await supabase.auth.signOut();
    router.push("/");
    router.refresh();
  };

  if (loading) {
    return (
      <main className="max-w-2xl mx-auto px-4 py-10">
        <p className="text-neutral-400 text-center">불러오는 중...</p>
      </main>
    );
  }

  if (error) {
    return (
      <main className="max-w-2xl mx-auto px-4 py-10">
        <p className="text-red-600 text-center">{error}</p>
      </main>
    );
  }

  const nickname = summary?.profile.nickname ?? "닉네임 미설정";
  const email = summary?.profile.email ?? "이메일 없음";
  const posts = summary?.bodycheck_posts ?? [];
  const weeklyWinCount = summary?.weekly_win_count ?? 0;

  return (
    <main className="max-w-2xl mx-auto px-4 py-8">
      <section className="rounded-2xl border border-neutral-200 bg-white p-5 mb-5">
        <h1 className="text-2xl font-bold text-neutral-900">마이페이지</h1>
        <p className="text-sm text-neutral-600 mt-1">{nickname}</p>
        <p className="text-xs text-neutral-500 mt-0.5">{email}</p>

        <div className="mt-4 rounded-xl bg-amber-50 border border-amber-200 p-3">
          <p className="text-sm font-semibold text-amber-800">🏆 주간 몸짱 선정 횟수</p>
          <p className="text-xl font-bold text-amber-900 mt-1">{weeklyWinCount}회</p>
        </div>

        <div className="mt-4 flex gap-2">
          <Link
            href="/hall-of-fame"
            className="px-4 min-h-[44px] rounded-xl border border-neutral-200 text-sm text-neutral-700 hover:bg-neutral-50 flex items-center"
          >
            명예의 전당
          </Link>
          <button
            type="button"
            onClick={handleLogout}
            disabled={loggingOut}
            className="px-4 min-h-[44px] rounded-xl bg-red-600 text-white text-sm font-medium hover:bg-red-700 disabled:opacity-60"
          >
            로그아웃
          </button>
        </div>
      </section>

      <section>
        <h2 className="text-lg font-bold text-neutral-900 mb-3">내 사진 몸평 게시글</h2>

        {posts.length === 0 ? (
          <p className="text-sm text-neutral-500 rounded-xl border border-neutral-200 bg-white p-4">
            아직 등록한 사진 몸평 게시글이 없습니다.
          </p>
        ) : (
          <div className="space-y-3">
            {posts.map((post) => (
              <Link
                key={post.id}
                href={`/community/${post.id}`}
                className="block rounded-2xl border border-neutral-200 bg-white p-4 hover:border-emerald-300 transition-all"
              >
                <div className="flex gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-neutral-400">{timeAgo(post.created_at)}</p>
                    <p className="text-sm font-semibold text-neutral-900 truncate mt-1">{post.title}</p>
                    <p className="text-xs text-indigo-700 mt-1">
                      평균 {post.average_score.toFixed(2)} / 투표 {post.vote_count}
                    </p>
                  </div>
                  {(post.images?.length ?? 0) > 0 && (
                    <img
                      src={post.images?.[0]}
                      alt=""
                      className="w-16 h-16 rounded-lg object-cover border border-neutral-100 shrink-0"
                    />
                  )}
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
