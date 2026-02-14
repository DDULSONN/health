"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type RankResponse =
  | {
      has_post: false;
      week: { start_utc: string; end_utc: string };
    }
  | {
      has_post: true;
      week: { start_utc: string; end_utc: string };
      rank: number;
      total: number;
      post: {
        id: string;
        title: string;
        score_sum: number;
        vote_count: number;
      };
    };

export default function MyWeeklyRankCard() {
  const [loading, setLoading] = useState(true);
  const [unauthorized, setUnauthorized] = useState(false);
  const [data, setData] = useState<RankResponse | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch("/api/rankings/my-weekly-bodycheck", { cache: "no-store" });
        if (!active) return;
        if (res.status === 401) {
          setUnauthorized(true);
          return;
        }
        if (!res.ok) return;
        setData((await res.json()) as RankResponse);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  if (loading) {
    return (
      <section className="mb-4 rounded-2xl border border-indigo-200 bg-indigo-50 p-4">
        <p className="text-sm text-indigo-700">이번주 내 순위 불러오는 중...</p>
      </section>
    );
  }

  if (unauthorized) return null;

  if (!data || !data.has_post) {
    return (
      <section className="mb-4 rounded-2xl border border-indigo-200 bg-indigo-50 p-4">
        <p className="text-base font-bold text-indigo-800">📈 이번주 내 순위</p>
        <p className="text-sm text-neutral-700 mt-2">이번주 몸평을 올려보세요.</p>
        <Link
          href="/community/write?type=photo_bodycheck"
          className="inline-flex mt-3 min-h-[40px] items-center px-3 rounded-lg bg-indigo-600 text-white text-sm"
        >
          몸평 올리기
        </Link>
      </section>
    );
  }

  return (
    <section className="mb-4 rounded-2xl border border-indigo-200 bg-indigo-50 p-4">
      <p className="text-base font-bold text-indigo-800">📈 이번주 내 순위</p>
      <p className="text-lg font-bold text-neutral-900 mt-2">
        이번주 내 몸평 순위: {data.rank}위 / {data.total}명
      </p>
      <p className="text-sm text-neutral-700 mt-1">
        점수 {data.post.score_sum} · 투표 {data.post.vote_count}
      </p>
      <Link href={`/community/${data.post.id}`} className="text-sm text-indigo-700 hover:underline mt-2 inline-block">
        내 게시글 보기
      </Link>
    </section>
  );
}
