"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { formatRemainingToKorean } from "@/lib/dating-open";

type CardDetail = {
  id: string;
  sex: "male" | "female";
  display_nickname: string;
  age: number | null;
  region: string | null;
  height_cm: number | null;
  job: string | null;
  training_years: number | null;
  ideal_type: string | null;
  total_3lift: number | null;
  is_3lift_verified: boolean;
  blur_thumb_url: string;
  expires_at: string;
};

export default function OpenCardDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [card, setCard] = useState<CardDetail | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    queueMicrotask(async () => {
      try {
        const res = await fetch(`/api/dating/cards/${id}`);
        if (!res.ok) {
          router.replace("/community/dating/cards");
          return;
        }
        const data = (await res.json()) as { card?: CardDetail };
        if (!data.card) {
          router.replace("/community/dating/cards");
          return;
        }
        setCard(data.card);
      } catch {
        router.replace("/community/dating/cards");
      }
      setLoading(false);
    });
  }, [id, router]);

  if (loading || !card) {
    return (
      <main className="max-w-2xl mx-auto px-4 py-8">
        <p className="text-neutral-500">불러오는 중...</p>
      </main>
    );
  }

  return (
    <main className="max-w-2xl mx-auto px-4 py-8">
      <Link href="/community/dating/cards" className="text-sm text-neutral-500 hover:text-neutral-700">
        뒤로가기
      </Link>

      <div className="rounded-2xl border border-neutral-200 bg-white p-5 mt-4">
        <div className="flex items-center justify-between gap-2">
          <h1 className="text-xl font-bold text-neutral-900">{card.display_nickname}</h1>
          <span className="inline-flex rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">
            ⏳ {formatRemainingToKorean(card.expires_at)}
          </span>
        </div>

        <div className="mt-3 h-56 rounded-xl border border-neutral-100 bg-neutral-50 overflow-hidden flex items-center justify-center">
          {card.blur_thumb_url ? (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={card.blur_thumb_url} alt="" className="h-full w-full object-contain blur-[9px]" />
            </>
          ) : (
            <div className="h-full w-full animate-pulse bg-neutral-100" />
          )}
        </div>

        <div className="mt-3 flex flex-wrap gap-2 text-xs text-neutral-600">
          {card.age != null && <span>나이 {card.age}세</span>}
          {card.region && <span>지역 {card.region}</span>}
          {card.height_cm != null && <span>키 {card.height_cm}cm</span>}
          {card.job && <span>직업 {card.job}</span>}
          {card.training_years != null && <span>운동 {card.training_years}년</span>}
        </div>

        {card.sex === "male" && (
          <div className="mt-2 flex flex-wrap gap-2">
            {card.total_3lift != null && (
              <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-rose-100 text-rose-700">3대 {card.total_3lift}kg</span>
            )}
          </div>
        )}

        {card.ideal_type && (
          <div className="mt-4 rounded-xl border border-pink-100 bg-pink-50 p-3">
            <p className="text-sm font-semibold text-pink-700">💘 이상형</p>
            <p className="mt-1 text-sm text-neutral-700 whitespace-pre-wrap break-words">{card.ideal_type}</p>
          </div>
        )}

        <div className="mt-4">
          <Link
            href={`/community/dating/cards/${card.id}/apply`}
            className="inline-flex min-h-[44px] items-center rounded-lg bg-pink-500 px-4 text-sm font-medium text-white hover:bg-pink-600"
          >
            지원하기
          </Link>
        </div>
      </div>
    </main>
  );
}
