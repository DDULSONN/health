"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

type BodycheckRating = "great" | "good" | "normal" | "rookie";

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

const RATING_BUTTONS: { rating: BodycheckRating; label: string; tone: string }[] = [
  { rating: "great", label: "매우 좋아요", tone: "bg-indigo-600 hover:bg-indigo-700" },
  { rating: "good", label: "좋아요", tone: "bg-sky-600 hover:bg-sky-700" },
  { rating: "normal", label: "보통", tone: "bg-neutral-700 hover:bg-neutral-800" },
  { rating: "rookie", label: "헬린이", tone: "bg-amber-500 hover:bg-amber-600" },
];

export default function HomeBodycheckQuickVote() {
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [payload, setPayload] = useState<HomeVotePayload | null>(null);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [lastVoteLabel, setLastVoteLabel] = useState<string | null>(null);

  async function loadQueue() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/bodycheck/home-vote", { cache: "no-store" });
      const data = (await res.json()) as HomeVotePayload & { error?: string };
      if (!res.ok || !data.ok) {
        setPayload(null);
        setQueue([]);
        setError(data.error ?? "홈 몸평 투표 목록을 불러오지 못했어요.");
        return;
      }
      setPayload(data);
      setQueue(data.items ?? []);
    } catch {
      setPayload(null);
      setQueue([]);
      setError("네트워크 오류로 몸평 투표 목록을 불러오지 못했어요.");
    } finally {
      setLoading(false);
    }
  }

  async function handleVote(rating: BodycheckRating) {
    const current = queue[0];
    if (!current || submitting) return;

    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/posts/${current.id}/vote`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rating }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) {
        setError(data.error ?? "투표 처리에 실패했어요.");
        return;
      }

      const selected = RATING_BUTTONS.find((item) => item.rating === rating);
      setLastVoteLabel(selected?.label ?? null);
      setQueue((prev) => prev.slice(1));
    } catch {
      setError("투표 중 네트워크 오류가 발생했어요.");
    } finally {
      setSubmitting(false);
    }
  }

  useEffect(() => {
    void loadQueue();
  }, []);

  const current = queue[0] ?? null;
  const remaining = Math.max(queue.length - 1, 0);
  const canVote = payload?.authenticated ?? false;
  const averageScore = useMemo(() => {
    if (!current?.vote_count) return 0;
    return Number((current.score_sum / current.vote_count).toFixed(2));
  }, [current]);

  return (
    <section className="mb-5 rounded-3xl border border-indigo-200 bg-gradient-to-r from-indigo-50 via-white to-sky-50 p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-indigo-700">홈 몸평 바로 투표</p>
          <h2 className="mt-1 text-xl font-bold text-neutral-900">이번 주 몸평 글을 홈에서 바로 평가해보세요</h2>
          <p className="mt-1 text-sm leading-relaxed text-neutral-600">
            투표한 점수는 이번 주 TOP과 명예의 전당 집계에 반영돼요.
          </p>
        </div>
        <div className="flex shrink-0 gap-2 text-xs font-semibold">
          <Link href="/community/bodycheck" className="rounded-full border border-indigo-200 bg-white px-3 py-2 text-indigo-700">
            몸평 게시판
          </Link>
          <Link href="/hall-of-fame" className="rounded-full border border-amber-200 bg-white px-3 py-2 text-amber-700">
            명예의 전당
          </Link>
        </div>
      </div>

      <div className="mt-4 rounded-2xl border border-indigo-100 bg-white/80 p-3">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-indigo-600">This Week Bodycheck</p>
          <p className="text-xs text-neutral-500">{payload?.week_id ?? "-"}</p>
        </div>
        <p className="mt-1 text-sm text-neutral-600">
          현재 주차 몸평 글 위주로 보여주고, 내가 이미 평가한 글은 자동으로 제외돼요.
        </p>
      </div>

      {loading ? <p className="mt-4 text-sm text-neutral-500">몸평 투표 카드를 불러오는 중...</p> : null}
      {error ? <p className="mt-4 text-sm text-red-600">{error}</p> : null}

      {!loading && current ? (
        <div className="mt-4 grid gap-4 lg:grid-cols-[220px_1fr]">
          <div className="overflow-hidden rounded-2xl border border-neutral-200 bg-white">
            {current.image_url ? (
              <Image
                src={current.image_url}
                alt={current.title}
                width={520}
                height={680}
                className="h-full w-full object-cover"
                unoptimized
              />
            ) : (
              <div className="flex min-h-[260px] items-center justify-center bg-neutral-100 text-sm text-neutral-500">
                사진 없음
              </div>
            )}
          </div>

          <div className="rounded-2xl border border-neutral-200 bg-white p-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-indigo-100 px-2.5 py-1 text-xs font-semibold text-indigo-700">
                사진 몸평
              </span>
              <span className="rounded-full bg-neutral-100 px-2.5 py-1 text-xs font-medium text-neutral-700">
                {current.gender === "female" ? "여성" : "남성"}
              </span>
              <span className="text-xs text-neutral-500">작성자 {current.nickname ?? "익명"}</span>
            </div>

            <h3 className="mt-3 text-lg font-bold text-neutral-900">{current.title}</h3>
            {current.content ? (
              <p className="mt-2 line-clamp-3 text-sm leading-relaxed text-neutral-600">{current.content}</p>
            ) : (
              <p className="mt-2 text-sm text-neutral-500">설명 없이 사진만 올린 몸평 글이에요.</p>
            )}

            <div className="mt-4 grid grid-cols-2 gap-3 rounded-2xl bg-neutral-50 p-3 text-sm text-neutral-700">
              <div>
                <p className="text-xs text-neutral-500">현재 평균</p>
                <p className="mt-1 font-semibold text-neutral-900">{averageScore.toFixed(2)}</p>
              </div>
              <div>
                <p className="text-xs text-neutral-500">누적 투표</p>
                <p className="mt-1 font-semibold text-neutral-900">{current.vote_count}표</p>
              </div>
            </div>

            {canVote ? (
              <div className="mt-4 grid grid-cols-2 gap-2">
                {RATING_BUTTONS.map((item) => (
                  <button
                    key={item.rating}
                    type="button"
                    onClick={() => void handleVote(item.rating)}
                    disabled={submitting}
                    className={`min-h-[46px] rounded-xl px-3 text-sm font-semibold text-white transition disabled:opacity-50 ${item.tone}`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            ) : (
              <div className="mt-4 rounded-2xl border border-dashed border-neutral-300 bg-neutral-50 p-4">
                <p className="text-sm text-neutral-600">로그인하면 홈에서 바로 몸평 투표에 참여할 수 있어요.</p>
                <Link href="/login?redirect=/" className="mt-3 inline-flex rounded-full bg-indigo-600 px-3 py-2 text-xs font-semibold text-white">
                  로그인하고 투표하기
                </Link>
              </div>
            )}

            <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-xs text-neutral-500">
              <p>
                {canVote
                  ? lastVoteLabel
                    ? `방금 "${lastVoteLabel}"로 평가했어요.`
                    : "원하는 느낌대로 바로 평가해보세요."
                  : "로그인 후 평가하면 다음 후보가 바로 이어서 보여요."}
              </p>
              <p>다음 후보 {remaining}명 남음</p>
            </div>
          </div>
        </div>
      ) : null}

      {!loading && !current ? (
        <div className="mt-4 rounded-2xl border border-dashed border-neutral-300 bg-white/70 p-4 text-sm text-neutral-600">
          <p>{payload?.message ?? "지금 바로 평가할 몸평 글이 없어요."}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Link href="/community/bodycheck" className="rounded-full bg-indigo-600 px-3 py-2 text-xs font-semibold text-white">
              몸평 게시판 보러가기
            </Link>
            {!payload?.authenticated ? (
              <Link href="/login?redirect=/" className="rounded-full border border-neutral-300 bg-white px-3 py-2 text-xs font-semibold text-neutral-700">
                로그인하고 투표하기
              </Link>
            ) : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}
