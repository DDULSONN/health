"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

type DatingCard = {
  id: string;
  sex: string;
  display_nickname: string;
  age: number;
  thumb_url: string;
  is_blur_fallback?: boolean;
  total_3lift?: number;
  percent_all?: number;
  training_years?: number;
  created_at: string;
};

export default function DatingListPage() {
  const [males, setMales] = useState<DatingCard[]>([]);
  const [females, setFemales] = useState<DatingCard[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/dating/public");
      if (res.ok) {
        const data = await res.json();
        setMales(data.males ?? []);
        setFemales(data.females ?? []);
      }
    } catch (e) {
      console.error("Dating public load error:", e);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    queueMicrotask(() => {
      void load();
    });
  }, [load]);

  return (
    <main className="max-w-2xl mx-auto px-4 py-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-neutral-900">소개팅</h1>
        <Link
          href="/dating/apply"
          className="px-4 min-h-[44px] flex items-center rounded-xl bg-pink-500 text-white text-sm font-medium hover:bg-pink-600 active:scale-[0.98] transition-all"
        >
          신청하기
        </Link>
      </div>

      {loading ? (
        <p className="text-neutral-400 text-center py-10">로딩 중...</p>
      ) : (
        <div className="space-y-8">
          {/* 남자 미리보기 */}
          <section>
            <h2 className="text-lg font-bold text-neutral-800 mb-3">
              💪 남자 미리보기
            </h2>
            {males.length === 0 ? (
              <EmptyState />
            ) : (
              <div className="grid grid-cols-1 gap-3">
                {males.map((card) => (
                  <MaleCard key={card.id} card={card} />
                ))}
              </div>
            )}
          </section>

          {/* 여자 미리보기 */}
          <section>
            <h2 className="text-lg font-bold text-neutral-800 mb-3">
              💘 여자 미리보기
            </h2>
            {females.length === 0 ? (
              <EmptyState />
            ) : (
              <div className="grid grid-cols-1 gap-3">
                {females.map((card) => (
                  <FemaleCard key={card.id} card={card} />
                ))}
              </div>
            )}
          </section>
        </div>
      )}
    </main>
  );
}

function EmptyState() {
  return (
    <div className="rounded-2xl border border-neutral-200 bg-neutral-50 p-6 text-center">
      <p className="text-sm font-medium text-neutral-600 mb-1">
        아직 공개된 카드가 없습니다.
      </p>
      <p className="text-xs text-neutral-400 mb-4">
        관리자 승인 후 미리보기에 표시됩니다.
      </p>
      <Link
        href="/dating/apply"
        className="inline-flex items-center px-4 py-2 rounded-xl bg-pink-500 text-white text-sm font-medium hover:bg-pink-600 active:scale-[0.98] transition-all"
      >
        신청하기
      </Link>
    </div>
  );
}

function MaleCard({ card }: { card: DatingCard }) {
  return (
    <Link
      href={`/community/dating/${card.id}`}
      className="flex items-center gap-4 rounded-2xl bg-white border border-neutral-200 p-4 hover:border-pink-300 hover:shadow-sm transition-all active:scale-[0.99]"
    >
      {card.thumb_url ? (
        <div className="shrink-0 w-16 h-16 rounded-xl overflow-hidden border border-neutral-100">
          <img
            src={card.thumb_url}
            alt=""
            className={`w-full h-full object-cover ${card.is_blur_fallback ? "scale-110 blur-md" : "blur-sm scale-105"}`}
          />
        </div>
      ) : (
        <div className="shrink-0 w-16 h-16 rounded-xl bg-neutral-100 flex items-center justify-center text-2xl">
          🏋️
        </div>
      )}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <span className="font-semibold text-neutral-900 text-sm">
            {card.display_nickname}
          </span>
          <span className="text-xs text-neutral-400">{card.age}세</span>
        </div>
        {card.training_years != null && (
          <p className="text-xs text-neutral-500 mb-1">운동경력 {card.training_years}년</p>
        )}
        <div className="flex items-center gap-2">
          {card.total_3lift != null && (
            <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-rose-100 text-rose-700">
              3대 {card.total_3lift}kg
            </span>
          )}
          {card.percent_all != null && (
            <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700">
              상위 {card.percent_all}%
            </span>
          )}
        </div>
      </div>
      <svg
        className="shrink-0 w-5 h-5 text-neutral-300"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        viewBox="0 0 24 24"
      >
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
      </svg>
    </Link>
  );
}

function FemaleCard({ card }: { card: DatingCard }) {
  const hasSbd = card.total_3lift != null && card.total_3lift > 0;

  return (
    <Link
      href={`/community/dating/${card.id}`}
      className="flex items-center gap-4 rounded-2xl bg-white border border-neutral-200 p-4 hover:border-pink-300 hover:shadow-sm transition-all active:scale-[0.99]"
    >
      {card.thumb_url ? (
        <div className="shrink-0 w-16 h-16 rounded-xl overflow-hidden border border-neutral-100">
          <img
            src={card.thumb_url}
            alt=""
            className={`w-full h-full object-cover ${card.is_blur_fallback ? "scale-110 blur-md" : "blur-sm scale-105"}`}
          />
        </div>
      ) : (
        <div className="shrink-0 w-16 h-16 rounded-xl bg-pink-50 flex items-center justify-center text-2xl">
          💘
        </div>
      )}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <span className="font-semibold text-neutral-900 text-sm">
            {card.display_nickname}
          </span>
          <span className="text-xs text-neutral-400">{card.age}세</span>
        </div>
        {card.training_years != null && (
          <p className="text-xs text-neutral-500 mb-1">운동경력 {card.training_years}년</p>
        )}
        {hasSbd && (
          <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-pink-100 text-pink-700">
            SBD 입력
          </span>
        )}
      </div>
      <svg
        className="shrink-0 w-5 h-5 text-neutral-300"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        viewBox="0 0 24 24"
      >
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
      </svg>
    </Link>
  );
}
