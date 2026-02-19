"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { formatRemainingToKorean } from "@/lib/dating-open";

type PublicCard = {
  id: string;
  sex: "male" | "female";
  display_nickname: string;
  age: number | null;
  region: string | null;
  height_cm: number | null;
  job: string | null;
  training_years: number | null;
  ideal_type: string | null;
  strengths_text: string | null;
  photo_visibility: "blur" | "public";
  total_3lift: number | null;
  is_3lift_verified: boolean;
  image_urls: string[];
  expires_at: string;
  created_at: string;
};

type QueueStats = {
  male: { pending_count: number; public_count: number; slot_limit: number };
  female: { pending_count: number; public_count: number; slot_limit: number };
};

const PAGE_SIZE = 20;

function maskIdealTypeForPreview(value: string | null): string {
  const raw = (value ?? "").trim();
  if (!raw) return "";
  const sensitivePattern =
    /(010|@|kakao|openchat|instagram|insta|\uCE74\uD1A1|\uC624\uD508\uCC44\uD305|\uC778\uC2A4\uD0C0)/i;
  if (sensitivePattern.test(raw)) return "***";
  return raw;
}

async function fetchBySex(sex: "male" | "female", offset: number) {
  const params = new URLSearchParams({ sex, limit: String(PAGE_SIZE), offset: String(offset) });
  const res = await fetch(`/api/dating/cards/public?${params.toString()}`);
  if (!res.ok) throw new Error("failed to load open cards");
  return (await res.json()) as {
    items: PublicCard[];
    hasMore: boolean;
    nextOffset: number;
  };
}

export default function OpenCardsPage() {
  const [males, setMales] = useState<PublicCard[]>([]);
  const [females, setFemales] = useState<PublicCard[]>([]);
  const [maleOffset, setMaleOffset] = useState(0);
  const [femaleOffset, setFemaleOffset] = useState(0);
  const [maleHasMore, setMaleHasMore] = useState(true);
  const [femaleHasMore, setFemaleHasMore] = useState(true);
  const [loading, setLoading] = useState(true);
  const [queueStats, setQueueStats] = useState<QueueStats | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const timer = window.setInterval(() => setTick((v) => v + 1), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const loadInitial = useCallback(async () => {
    setLoading(true);
    try {
      const [m, f, qsRes] = await Promise.all([
        fetchBySex("male", 0),
        fetchBySex("female", 0),
        fetch("/api/dating/cards/queue-stats", { cache: "no-store" }),
      ]);
      setMales(m.items ?? []);
      setFemales(f.items ?? []);
      setMaleOffset(m.nextOffset ?? (m.items?.length ?? 0));
      setFemaleOffset(f.nextOffset ?? (f.items?.length ?? 0));
      setMaleHasMore(Boolean(m.hasMore));
      setFemaleHasMore(Boolean(f.hasMore));
      if (qsRes.ok) {
        const qsBody = (await qsRes.json()) as QueueStats;
        setQueueStats(qsBody);
      } else {
        setQueueStats(null);
      }
    } catch (e) {
      console.error("open cards load failed", e);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    queueMicrotask(() => {
      void loadInitial();
    });
  }, [loadInitial]);

  const loadMoreMale = useCallback(async () => {
    if (!maleHasMore) return;
    try {
      const m = await fetchBySex("male", maleOffset);
      setMales((prev) => [...prev, ...(m.items ?? [])]);
      setMaleOffset(m.nextOffset ?? maleOffset + (m.items?.length ?? 0));
      setMaleHasMore(Boolean(m.hasMore));
    } catch (e) {
      console.error("open cards load more male failed", e);
    }
  }, [maleHasMore, maleOffset]);

  const loadMoreFemale = useCallback(async () => {
    if (!femaleHasMore) return;
    try {
      const f = await fetchBySex("female", femaleOffset);
      setFemales((prev) => [...prev, ...(f.items ?? [])]);
      setFemaleOffset(f.nextOffset ?? femaleOffset + (f.items?.length ?? 0));
      setFemaleHasMore(Boolean(f.hasMore));
    } catch (e) {
      console.error("open cards load more female failed", e);
    }
  }, [femaleHasMore, femaleOffset]);

  const nowLabel = useMemo(() => tick, [tick]);
  void nowLabel;

  return (
    <main className="max-w-3xl mx-auto px-4 py-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-neutral-900">오픈카드</h1>
          <p className="text-sm text-neutral-500 mt-1">공개 카드는 48시간 동안 노출됩니다.</p>
          {queueStats && (
            <p className="text-xs text-neutral-500 mt-1">
              대기열: 남자 {queueStats.male.pending_count}명 / 여자 {queueStats.female.pending_count}명
            </p>
          )}
        </div>
        <Link
          href="/dating/card/new"
          className="inline-flex min-h-[40px] items-center rounded-lg border border-pink-200 bg-pink-50 px-3 text-sm font-medium text-pink-700 hover:bg-pink-100"
        >
          오픈카드 작성
        </Link>
      </div>

      {loading ? (
        <p className="text-neutral-400 text-center py-10">불러오는 중...</p>
      ) : (
        <div className="space-y-8">
          <Section title="남자 오픈카드" items={males} hasMore={maleHasMore} onMore={loadMoreMale} />
          <Section title="여자 오픈카드" items={females} hasMore={femaleHasMore} onMore={loadMoreFemale} />
        </div>
      )}
    </main>
  );
}

function Section({
  title,
  items,
  hasMore,
  onMore,
}: {
  title: string;
  items: PublicCard[];
  hasMore: boolean;
  onMore: () => void;
}) {
  return (
    <section>
      <h2 className="text-lg font-bold text-neutral-800 mb-3">{title}</h2>
      {items.length === 0 ? (
        <p className="rounded-2xl border border-neutral-200 bg-neutral-50 p-4 text-sm text-neutral-500">현재 공개된 카드가 없습니다.</p>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-3">
            {items.map((card) => (
              <CardRow key={card.id} card={card} />
            ))}
          </div>
          {hasMore && (
            <button
              type="button"
              onClick={onMore}
              className="mt-3 w-full min-h-[44px] rounded-xl border border-neutral-300 bg-white text-sm font-medium text-neutral-700 hover:bg-neutral-50"
            >
              더 보기
            </button>
          )}
        </>
      )}
    </section>
  );
}

function CardRow({ card }: { card: PublicCard }) {
  const ideal = maskIdealTypeForPreview(card.ideal_type);

  return (
    <div className="rounded-2xl border border-neutral-200 bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2 text-sm text-neutral-700">
          <span className="font-semibold text-neutral-900">{card.display_nickname}</span>
          {card.age != null && <span>{card.age}세</span>}
          {card.region && <span>{card.region}</span>}
        </div>
        <span className="inline-flex rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">
          ⏳ {formatRemainingToKorean(card.expires_at)}
        </span>
      </div>

      <div
        className={`mt-3 w-full rounded-xl border border-neutral-100 bg-neutral-50 overflow-hidden ${
          card.image_urls.length >= 2 ? "grid grid-cols-2 gap-1 h-44" : "h-44 flex items-center justify-center"
        }`}
      >
        {card.image_urls.length > 0 ? (
          card.image_urls.map((url, idx) => (
            <div key={`${card.id}-${idx}`} className="h-full w-full flex items-center justify-center bg-neutral-50">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={url}
                alt=""
                className={`h-full w-full object-contain ${card.photo_visibility === "public" ? "" : "blur-[9px]"}`}
              />
            </div>
          ))
        ) : (
          <div className="h-full w-full animate-pulse bg-neutral-100" />
        )}
      </div>

      <div className="mt-2 flex flex-wrap gap-2 text-xs text-neutral-600">
        {card.height_cm != null && <span>키 {card.height_cm}cm</span>}
        {card.job && <span>직업 {card.job}</span>}
        {card.training_years != null && <span>운동 {card.training_years}년</span>}
      </div>

      {ideal && <p className="mt-2 text-xs text-pink-700 truncate">💘 이상형: {ideal}</p>}
      {card.strengths_text && <p className="mt-1 text-xs text-emerald-700 truncate">✨ 내 장점: {card.strengths_text}</p>}

      {card.sex === "male" && (
        <div className="mt-2 flex flex-wrap gap-2">
          {card.total_3lift != null && (
            <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-rose-100 text-rose-700">3대 {card.total_3lift}kg</span>
          )}
        </div>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        <Link
          href={`/community/dating/cards/${card.id}`}
          className="inline-flex min-h-[40px] items-center rounded-lg border border-neutral-300 px-4 text-sm text-neutral-700 hover:bg-neutral-50"
        >
          상세보기
        </Link>
        <Link
          href={`/community/dating/cards/${card.id}/apply`}
          className="inline-flex min-h-[40px] items-center rounded-lg bg-pink-500 px-4 text-sm font-medium text-white hover:bg-pink-600"
        >
          지원하기
        </Link>
      </div>
    </div>
  );
}
