"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import { toBodyBattleImageUrl } from "@/lib/bodybattle-image";

type MatchEntry = {
  id: string;
  nickname: string;
  image_url: string | null;
};

type CurrentPayload = {
  ok: boolean;
  season: {
    id: string;
    week_id: string;
    theme_label: string;
  } | null;
  matchup: {
    matchup_key: string;
    prompt: string;
    left: MatchEntry;
    right: MatchEntry;
  } | null;
  message?: string;
};

type VoteFeedback = {
  left_pct: number;
  right_pct: number;
  draw_pct: number;
  total: number;
};

export default function HomeBodyBattleQuickVote() {
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [payload, setPayload] = useState<CurrentPayload | null>(null);
  const [feedback, setFeedback] = useState<VoteFeedback | null>(null);
  const [hidden, setHidden] = useState(false);

  async function loadCurrent() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/bodybattle/current", { cache: "no-store" });
      if (res.status === 401 || res.status === 403) {
        setHidden(true);
        setPayload(null);
        return;
      }
      const data = (await res.json()) as CurrentPayload;
      if (!res.ok || !data.ok) {
        setError("바디배틀 정보를 불러오지 못했습니다.");
        setPayload(null);
        return;
      }
      setPayload(data);
    } catch {
      setError("네트워크 오류가 발생했습니다.");
      setPayload(null);
    } finally {
      setLoading(false);
    }
  }

  async function vote(side: "left" | "right" | "draw") {
    if (!payload?.season || !payload.matchup || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/bodybattle/vote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          season_id: payload.season.id,
          left_entry_id: payload.matchup.left.id,
          right_entry_id: payload.matchup.right.id,
          winner_side: side,
          matchup_key: payload.matchup.matchup_key,
        }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        message?: string;
        matchup_stats?: VoteFeedback;
      };
      if (!res.ok || !data.ok) {
        setError(data.message ?? "투표 처리에 실패했습니다.");
        return;
      }
      if (data.matchup_stats) setFeedback(data.matchup_stats);
      await loadCurrent();
    } catch {
      setError("투표 중 네트워크 오류가 발생했습니다.");
    } finally {
      setSubmitting(false);
    }
  }

  useEffect(() => {
    void loadCurrent();
  }, []);

  const leftImage = toBodyBattleImageUrl(payload?.matchup?.left.image_url, { width: 720, quality: 72 });
  const rightImage = toBodyBattleImageUrl(payload?.matchup?.right.image_url, { width: 720, quality: 72 });

  if (hidden) return null;

  return (
    <section className="mb-5 rounded-2xl border border-orange-200 bg-gradient-to-r from-orange-50 to-amber-50 p-4">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-sm font-semibold text-orange-800">바디배틀 바로 투표</p>
        <Link href="/bodybattle" className="text-xs font-semibold text-orange-700 underline">
          전체 보기
        </Link>
      </div>

      {loading ? <p className="text-xs text-neutral-600">대결 카드를 불러오는 중...</p> : null}
      {error ? <p className="text-xs text-red-600">{error}</p> : null}

      {!loading && payload?.season && payload?.matchup ? (
        <>
          <div className="mb-2 rounded-xl border border-orange-200 bg-white/80 px-3 py-2">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-orange-700">This Week Theme</p>
            <p className="mt-0.5 text-xs text-neutral-500">{payload.season.week_id}</p>
            <p className="text-sm font-semibold text-neutral-900">{payload.season.theme_label}</p>
          </div>
          <p className="text-sm font-semibold text-neutral-900">{payload.matchup.prompt}</p>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <div className="rounded-lg border border-neutral-200 bg-white p-2">
              {leftImage ? (
                <Image src={leftImage} alt="" width={360} height={420} className="h-32 w-full rounded object-contain bg-neutral-100" unoptimized />
              ) : null}
              <p className="mt-1 truncate text-xs font-semibold text-neutral-800">{payload.matchup.left.nickname}</p>
            </div>
            <div className="rounded-lg border border-neutral-200 bg-white p-2">
              {rightImage ? (
                <Image src={rightImage} alt="" width={360} height={420} className="h-32 w-full rounded object-contain bg-neutral-100" unoptimized />
              ) : null}
              <p className="mt-1 truncate text-xs font-semibold text-neutral-800">{payload.matchup.right.nickname}</p>
            </div>
          </div>
          <div className="mt-2 grid grid-cols-3 gap-2">
            <button
              type="button"
              onClick={() => vote("left")}
              disabled={submitting}
              className="min-h-[44px] rounded-lg bg-blue-600 px-2 text-xs font-semibold text-white disabled:opacity-50"
            >
              왼쪽
            </button>
            <button
              type="button"
              onClick={() => vote("draw")}
              disabled={submitting}
              className="min-h-[44px] rounded-lg bg-neutral-700 px-2 text-xs font-semibold text-white disabled:opacity-50"
            >
              비슷함
            </button>
            <button
              type="button"
              onClick={() => vote("right")}
              disabled={submitting}
              className="min-h-[44px] rounded-lg bg-blue-600 px-2 text-xs font-semibold text-white disabled:opacity-50"
            >
              오른쪽
            </button>
          </div>
          {feedback ? (
            <p className="mt-2 text-xs text-neutral-700">
              결과: 왼쪽 {feedback.left_pct}% · 비슷함 {feedback.draw_pct}% · 오른쪽 {feedback.right_pct}% · 총 {feedback.total}표
            </p>
          ) : null}
        </>
      ) : null}

      {!loading && !payload?.season ? <p className="text-xs text-neutral-600">현재 진행 중인 시즌이 없습니다.</p> : null}
      {!loading && payload?.season && !payload?.matchup ? (
        <p className="text-xs text-neutral-600">{payload.message ?? "매칭 대기 중입니다."}</p>
      ) : null}
    </section>
  );
}
