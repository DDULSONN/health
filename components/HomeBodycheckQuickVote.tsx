"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { withImageTransform } from "@/lib/images";

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
  { rating: "rookie", label: "노력중", tone: "bg-amber-500 hover:bg-amber-600" },
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
  const canVote = payload?.authenticated ?? false;
  const currentImageUrl = withImageTransform(current?.image_url, { width: 720, quality: 68 });
  const averageScore = useMemo(() => {
    if (!current?.vote_count) return 0;
    return Number((current.score_sum / current.vote_count).toFixed(2));
  }, [current]);

  return (
    <section className="mb-5 rounded-3xl border border-indigo-200 bg-gradient-to-br from-indigo-50 via-white to-sky-50 p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-indigo-600">Home Bodycheck</p>
          <h2 className="mt-1 text-lg font-bold text-neutral-900 sm:text-xl">홈에서 바로 몸평하기</h2>
          <p className="mt-1 text-sm text-neutral-600">이번 주 몸평 글을 빠르게 보고 한 번에 평가해보세요.</p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <Link
            href="/community?tab=photo_bodycheck"
            className="inline-flex min-h-[36px] items-center rounded-full border border-indigo-200 bg-white px-3 text-xs font-semibold text-indigo-700"
          >
            몸평 탭
          </Link>
          <Link
            href="/hall-of-fame"
            className="inline-flex min-h-[36px] items-center rounded-full border border-amber-200 bg-white px-3 text-xs font-semibold text-amber-700"
          >
            명예의 전당
          </Link>
        </div>
      </div>

      <div className="mt-3 flex items-center justify-between rounded-2xl border border-indigo-100 bg-white/80 px-4 py-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-indigo-500">This Week</p>
          <p className="mt-1 text-sm text-neutral-600">이미 평가한 글은 자동으로 제외돼요.</p>
        </div>
        <p className="text-xs font-medium text-neutral-500">{payload?.week_id ?? "-"}</p>
      </div>

      {loading ? <p className="mt-4 text-sm text-neutral-500">몸평 카드 불러오는 중...</p> : null}
      {error ? <p className="mt-4 text-sm text-red-600">{error}</p> : null}

      {!loading && current ? (
        <div className="mt-4 rounded-2xl border border-neutral-200 bg-white p-3 sm:p-4">
          <div className="flex flex-col gap-4 sm:flex-row">
            <div className="overflow-hidden rounded-2xl border border-neutral-200 bg-neutral-100 sm:w-36 sm:shrink-0">
              {current.image_url ? (
                <Image
                  src={currentImageUrl ?? current.image_url}
                  alt={current.title}
                  width={520}
                  height={680}
                  className="aspect-[4/5] h-full w-full object-cover"
                  unoptimized
                />
              ) : (
                <div className="flex aspect-[4/5] items-center justify-center text-sm text-neutral-500">사진 없음</div>
              )}
            </div>

            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-indigo-100 px-2.5 py-1 text-[11px] font-semibold text-indigo-700">
                  사진 몸평
                </span>
                <span className="rounded-full bg-neutral-100 px-2.5 py-1 text-[11px] font-medium text-neutral-700">
                  {current.gender === "female" ? "여성" : "남성"}
                </span>
                <span className="text-xs text-neutral-500">{current.nickname ?? "익명"}</span>
              </div>

              <h3 className="mt-3 line-clamp-2 text-base font-bold text-neutral-900 sm:text-lg">{current.title}</h3>
              {current.content ? (
                <p className="mt-2 line-clamp-2 text-sm text-neutral-600">{current.content}</p>
              ) : (
                <p className="mt-2 text-sm text-neutral-500">사진 중심으로 평가받는 몸평 글이에요.</p>
              )}

              <div className="mt-3 flex flex-wrap gap-2 text-xs font-medium">
                <span className="rounded-full bg-neutral-100 px-3 py-1 text-neutral-700">
                  평균 {averageScore.toFixed(2)}
                </span>
                <span className="rounded-full bg-neutral-100 px-3 py-1 text-neutral-700">
                  투표 {current.vote_count}표
                </span>
              </div>
            </div>
          </div>

          {canVote ? (
            <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
              {RATING_BUTTONS.map((item) => (
                <button
                  key={item.rating}
                  type="button"
                  onClick={() => void handleVote(item.rating)}
                  disabled={submitting}
                  className={`min-h-[44px] rounded-xl px-3 text-sm font-semibold text-white transition disabled:opacity-50 ${item.tone}`}
                >
                  {item.label}
                </button>
              ))}
            </div>
          ) : (
            <div className="mt-4 rounded-2xl border border-dashed border-neutral-300 bg-neutral-50 p-4">
              <p className="text-sm text-neutral-600">로그인하면 홈에서 바로 몸평에 참여할 수 있어요.</p>
              <Link
                href="/login?redirect=/"
                className="mt-3 inline-flex rounded-full bg-indigo-600 px-3 py-2 text-xs font-semibold text-white"
              >
                로그인하고 투표하기
              </Link>
            </div>
          )}

          <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-xs text-neutral-500">
            <p>{lastVoteLabel ? `방금 "${lastVoteLabel}"로 평가했어요.` : "가볍게 넘기듯 빠르게 평가해보세요."}</p>
            <p>남은 후보 {queue.length - 1}개</p>
          </div>
        </div>
      ) : null}

      {!loading && !current ? (
        <div className="mt-4 rounded-2xl border border-dashed border-neutral-300 bg-white/80 p-4">
          <p className="text-sm text-neutral-600">
            {payload?.message ?? "이번 주에 바로 평가할 몸평 글이 아직 없어요."}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Link
              href="/community?tab=photo_bodycheck"
              className="inline-flex min-h-[36px] items-center rounded-full bg-indigo-600 px-3 text-xs font-semibold text-white"
            >
              몸평 글 보러가기
            </Link>
            {!payload?.authenticated ? (
              <Link
                href="/login?redirect=/"
                className="inline-flex min-h-[36px] items-center rounded-full border border-neutral-300 bg-white px-3 text-xs font-semibold text-neutral-700"
              >
                로그인
              </Link>
            ) : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}
