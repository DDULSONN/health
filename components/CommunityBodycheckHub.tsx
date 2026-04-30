"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  BODYCHECK_RATINGS,
  type BodycheckRating,
} from "@/lib/community";

type QueueItem = {
  id: string;
  title: string;
  content: string | null;
  created_at: string;
  gender: "male" | "female" | null;
  score_sum: number;
  vote_count: number;
  image_url: string | null;
  nickname: string | null;
};

type HomeVotePayload = {
  ok: boolean;
  authenticated: boolean;
  week_id: string;
  items: QueueItem[];
  message?: string | null;
};

type RankingGender = "male" | "female";

type WeeklyTopItem = {
  post_id: string;
  title: string;
  created_at: string;
  score_avg: number;
  vote_count: number;
  images: string[];
  profiles?: { nickname: string } | null;
};

type WeeklyRankingResponse = {
  week_id: string;
  gender: RankingGender;
  min_votes: number;
  items: WeeklyTopItem[];
};

export default function CommunityBodycheckHub() {
  const [payload, setPayload] = useState<HomeVotePayload | null>(null);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [hubLoading, setHubLoading] = useState(true);
  const [voteLoading, setVoteLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastVoteLabel, setLastVoteLabel] = useState<string | null>(null);
  const [rankingGender, setRankingGender] = useState<RankingGender>("male");
  const [ranking, setRanking] = useState<WeeklyRankingResponse | null>(null);
  const [rankingLoading, setRankingLoading] = useState(true);

  const current = queue[0] ?? null;
  const canVote = payload?.authenticated ?? false;
  const averageScore = useMemo(() => {
    if (!current?.vote_count) return 0;
    return Number((current.score_sum / current.vote_count).toFixed(2));
  }, [current]);

  async function loadHub() {
    setHubLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/bodycheck/home-vote", { cache: "no-store" });
      const data = (await res.json()) as HomeVotePayload & { error?: string };
      if (!res.ok || !data.ok) {
        setPayload(null);
        setQueue([]);
        setError(data.error ?? "몸평 글을 불러오지 못했어요.");
        return;
      }
      setPayload(data);
      setQueue(data.items ?? []);
    } catch {
      setPayload(null);
      setQueue([]);
      setError("몸평 글을 불러오는 중 오류가 발생했어요.");
    } finally {
      setHubLoading(false);
    }
  }

  async function loadRanking(gender: RankingGender) {
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
    } catch {
      setRanking(null);
    } finally {
      setRankingLoading(false);
    }
  }

  async function handleVote(rating: BodycheckRating) {
    const target = current;
    if (!target || voteLoading) return;

    setVoteLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/posts/${target.id}/vote`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rating }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) {
        setError(data.error ?? "투표 처리에 실패했어요.");
        return;
      }

      const selected = BODYCHECK_RATINGS.find((item) => item.rating === rating);
      setLastVoteLabel(selected?.label ?? null);
      setQueue((prev) => prev.slice(1));
      void loadRanking(rankingGender);
    } catch {
      setError("투표 중 오류가 발생했어요.");
    } finally {
      setVoteLoading(false);
    }
  }

  useEffect(() => {
    void loadHub();
  }, []);

  useEffect(() => {
    void loadRanking(rankingGender);
  }, [rankingGender]);

  return (
    <section className="mt-5 rounded-[28px] border border-neutral-200 bg-white p-4 shadow-sm sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-neutral-400">사진 몸평</p>
          <h2 className="mt-1 text-xl font-black text-neutral-900 sm:text-2xl">
            사진 보고 바로 투표할 수 있어요.
          </h2>
          <p className="mt-2 text-sm text-neutral-500">
            커뮤니티에서 많이 본 몸평 글을 바로 보고, 마음 가는 대로 바로 평가해보세요.
          </p>
        </div>
        <Link
          href="/community?tab=photo_bodycheck"
          className="inline-flex min-h-[42px] items-center rounded-full border border-neutral-300 px-4 text-sm font-semibold text-neutral-700 transition hover:border-neutral-400 hover:bg-neutral-50"
        >
          몸평 글 모아보기
        </Link>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1.35fr)_320px]">
        <div className="rounded-[24px] border border-neutral-200 bg-neutral-50 p-3 sm:p-4">
          {hubLoading ? (
            <div className="rounded-[20px] bg-white px-4 py-10 text-center text-sm text-neutral-500">
              몸평 글을 불러오는 중입니다.
            </div>
          ) : error ? (
            <div className="rounded-[20px] bg-white px-4 py-10 text-center text-sm text-red-600">{error}</div>
          ) : current ? (
            <div className="rounded-[20px] bg-white p-3 sm:p-4">
              <div className="flex flex-col gap-4 sm:flex-row">
                <div className="overflow-hidden rounded-[20px] border border-neutral-200 bg-neutral-100 sm:w-44 sm:shrink-0">
                  {current.image_url ? (
                    <img
                      src={current.image_url}
                      alt={current.title}
                      loading="lazy"
                      decoding="async"
                      className="aspect-[4/5] h-full w-full object-cover"
                    />
                  ) : (
                    <div className="flex aspect-[4/5] items-center justify-center text-sm text-neutral-500">
                      사진 없음
                    </div>
                  )}
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full bg-indigo-100 px-2.5 py-1 text-[11px] font-semibold text-indigo-700">
                      사진 몸평
                    </span>
                    <span className="rounded-full bg-neutral-100 px-2.5 py-1 text-[11px] font-medium text-neutral-700">
                      {current.gender === "female" ? "여성" : current.gender === "male" ? "남성" : "공개"}
                    </span>
                    <span className="text-xs text-neutral-500">{current.nickname ?? "익명"}</span>
                  </div>

                  <h3 className="mt-3 line-clamp-2 text-lg font-bold text-neutral-900">{current.title}</h3>
                  <p className="mt-2 line-clamp-2 text-sm text-neutral-600">
                    {current.content || "사진을 보고 바로 평가할 수 있는 몸평 글이에요."}
                  </p>

                  <div className="mt-3 flex flex-wrap gap-2 text-xs font-medium">
                    <span className="rounded-full bg-neutral-100 px-3 py-1 text-neutral-700">
                      평균 {averageScore.toFixed(2)}
                    </span>
                    <span className="rounded-full bg-neutral-100 px-3 py-1 text-neutral-700">
                      투표 {current.vote_count}명
                    </span>
                    <span className="rounded-full bg-neutral-100 px-3 py-1 text-neutral-700">
                      남은 후보 {Math.max(queue.length - 1, 0)}명
                    </span>
                  </div>

                  {canVote ? (
                    <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
                      {BODYCHECK_RATINGS.map((item) => (
                        <button
                          key={item.rating}
                          type="button"
                          onClick={() => void handleVote(item.rating)}
                          disabled={voteLoading}
                          className="min-h-[44px] rounded-xl border border-neutral-300 bg-white px-3 text-sm font-semibold text-neutral-700 transition hover:border-indigo-300 hover:text-indigo-600 disabled:cursor-wait disabled:opacity-60"
                        >
                          {item.label}
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div className="mt-4 rounded-2xl border border-dashed border-neutral-300 bg-neutral-50 p-4">
                      <p className="text-sm text-neutral-600">로그인하면 여기서 바로 투표할 수 있어요.</p>
                      <Link
                        href="/login?redirect=/community?tab=photo_bodycheck"
                        className="mt-3 inline-flex rounded-full bg-neutral-900 px-3 py-2 text-xs font-semibold text-white"
                      >
                        로그인 후 투표
                      </Link>
                    </div>
                  )}

                  <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-xs text-neutral-500">
                    <p>{lastVoteLabel ? `방금 "${lastVoteLabel}"로 평가했어요.` : "가볍게 둘러보고 바로 평가해보세요."}</p>
                    <Link href={`/community/${current.id}`} className="font-semibold text-neutral-700 underline-offset-2 hover:underline">
                      상세 보기
                    </Link>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="rounded-[20px] bg-white px-4 py-10 text-center text-sm text-neutral-500">
              {payload?.message ?? "이번 주에 바로 평가할 몸평 글이 아직 없어요."}
            </div>
          )}
        </div>

        <div className="rounded-[24px] border border-neutral-200 bg-neutral-50 p-3 sm:p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-neutral-400">이번 주 랭킹</p>
              <h3 className="mt-1 text-base font-bold text-neutral-900">가장 반응 좋은 글</h3>
            </div>
            <div className="grid grid-cols-2 overflow-hidden rounded-full border border-neutral-200 bg-white text-xs font-semibold">
              <button
                type="button"
                onClick={() => setRankingGender("male")}
                className={`px-3 py-2 transition ${rankingGender === "male" ? "bg-neutral-900 text-white" : "text-neutral-600"}`}
              >
                남성
              </button>
              <button
                type="button"
                onClick={() => setRankingGender("female")}
                className={`px-3 py-2 transition ${rankingGender === "female" ? "bg-neutral-900 text-white" : "text-neutral-600"}`}
              >
                여성
              </button>
            </div>
          </div>

          {rankingLoading ? (
            <div className="mt-4 rounded-[20px] bg-white px-4 py-8 text-center text-sm text-neutral-500">
              랭킹을 불러오는 중입니다.
            </div>
          ) : !ranking?.items?.length ? (
            <div className="mt-4 rounded-[20px] bg-white px-4 py-8 text-center text-sm text-neutral-500">
              아직 집계된 랭킹이 없어요.
            </div>
          ) : (
            <div className="mt-4 space-y-3">
              {ranking.items.slice(0, 3).map((item, index) => {
                const previewImage = item.images[0] ?? "";
                return (
                  <Link
                    key={item.post_id}
                    href={`/community/${item.post_id}`}
                    className="flex items-center gap-3 rounded-[20px] bg-white p-3 transition hover:-translate-y-0.5 hover:shadow-sm"
                  >
                    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-neutral-900 text-sm font-black text-white">
                      {index + 1}
                    </div>
                    {previewImage ? (
                      <div className="h-14 w-14 shrink-0 overflow-hidden rounded-2xl bg-neutral-100">
                        <img src={previewImage} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" />
                      </div>
                    ) : null}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-neutral-900">
                        {item.profiles?.nickname ?? "익명"}
                      </p>
                      <p className="mt-1 line-clamp-1 text-xs text-neutral-500">{item.title}</p>
                      <p className="mt-1 text-[11px] font-medium text-neutral-400">
                        평균 {item.score_avg.toFixed(2)} · 투표 {item.vote_count}명
                      </p>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
