"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

type DatingCard = {
  id: string;
  sex: "male" | "female";
  display_nickname: string;
  age: number;
  total_3lift?: number;
  percent_all?: number;
  training_years?: number;
  ideal_type?: string;
  created_at: string;
};

const PAGE_SIZE = 20;

function maskIdealTypeForPreview(value?: string): string {
  const raw = value?.trim() ?? "";
  if (!raw) return "";

  const sensitivePattern =
    /(010|@|kakao|openchat|instagram|insta|\uCE74\uD1A1|\uC624\uD508\uCC44\uD305|\uC778\uC2A4\uD0C0)/i;

  if (sensitivePattern.test(raw)) return "***";
  return raw;
}

async function fetchSexCards(sex: "male" | "female", offset: number) {
  const params = new URLSearchParams({
    sex,
    limit: String(PAGE_SIZE),
    offset: String(offset),
  });
  const res = await fetch(`/api/dating/public?${params.toString()}`);
  if (!res.ok) throw new Error("failed to load dating public cards");
  return (await res.json()) as {
    items: DatingCard[];
    hasMore: boolean;
    nextOffset: number;
  };
}

export default function DatingListPage() {
  const [males, setMales] = useState<DatingCard[]>([]);
  const [females, setFemales] = useState<DatingCard[]>([]);
  const [maleOffset, setMaleOffset] = useState(0);
  const [femaleOffset, setFemaleOffset] = useState(0);
  const [maleHasMore, setMaleHasMore] = useState(true);
  const [femaleHasMore, setFemaleHasMore] = useState(true);
  const [loading, setLoading] = useState(true);
  const [loadingMoreMale, setLoadingMoreMale] = useState(false);
  const [loadingMoreFemale, setLoadingMoreFemale] = useState(false);

  const loadInitial = useCallback(async () => {
    setLoading(true);
    try {
      const [maleData, femaleData] = await Promise.all([
        fetchSexCards("male", 0),
        fetchSexCards("female", 0),
      ]);
      setMales(maleData.items);
      setFemales(femaleData.items);
      setMaleOffset(maleData.nextOffset);
      setFemaleOffset(femaleData.nextOffset);
      setMaleHasMore(maleData.hasMore);
      setFemaleHasMore(femaleData.hasMore);
    } catch (e) {
      console.error("Dating public load error:", e);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    queueMicrotask(() => {
      void loadInitial();
    });
  }, [loadInitial]);

  const loadMoreMale = useCallback(async () => {
    if (!maleHasMore || loadingMoreMale) return;
    setLoadingMoreMale(true);
    try {
      const data = await fetchSexCards("male", maleOffset);
      setMales((prev) => [...prev, ...data.items]);
      setMaleOffset(data.nextOffset);
      setMaleHasMore(data.hasMore);
    } catch (e) {
      console.error("Dating male load more error:", e);
    }
    setLoadingMoreMale(false);
  }, [maleHasMore, loadingMoreMale, maleOffset]);

  const loadMoreFemale = useCallback(async () => {
    if (!femaleHasMore || loadingMoreFemale) return;
    setLoadingMoreFemale(true);
    try {
      const data = await fetchSexCards("female", femaleOffset);
      setFemales((prev) => [...prev, ...data.items]);
      setFemaleOffset(data.nextOffset);
      setFemaleHasMore(data.hasMore);
    } catch (e) {
      console.error("Dating female load more error:", e);
    }
    setLoadingMoreFemale(false);
  }, [femaleHasMore, loadingMoreFemale, femaleOffset]);

  return (
    <main className="max-w-2xl mx-auto px-4 py-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-neutral-900">{"\uC18C\uAC1C\uD305"}</h1>
        <div className="flex items-center gap-2">
          <Link
            href="/community/dating/cards"
            className="px-3 min-h-[40px] flex items-center rounded-xl border border-pink-200 bg-pink-50 text-pink-700 text-sm font-medium hover:bg-pink-100"
          >
            {"\uC624\uD508 \uCE74\uB4DC"}
          </Link>
          <Link
            href="/dating/apply"
            className="px-4 min-h-[44px] flex items-center rounded-xl bg-pink-500 text-white text-sm font-medium hover:bg-pink-600 active:scale-[0.98] transition-all"
          >
            {"\uC2E0\uCCAD\uD558\uAE30"}
          </Link>
        </div>
      </div>

      {loading ? (
        <p className="text-neutral-400 text-center py-10">{"\uB85C\uB529 \uC911..."}</p>
      ) : (
        <div className="space-y-8">
          <section>
            <h2 className="text-lg font-bold text-neutral-800 mb-3">{"\uB0A8\uC790 \uBBF8\uB9AC\uBCF4\uAE30"}</h2>
            {males.length === 0 ? (
              <EmptyState />
            ) : (
              <>
                <div className="grid grid-cols-1 gap-3">
                  {males.map((card) => (
                    <MaleCard key={card.id} card={card} />
                  ))}
                </div>
                {maleHasMore && (
                  <button
                    type="button"
                    onClick={() => void loadMoreMale()}
                    disabled={loadingMoreMale}
                    className="mt-3 w-full min-h-[44px] rounded-xl border border-neutral-300 bg-white text-sm font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-50"
                  >
                    {loadingMoreMale ? "Loading..." : "\uB354 \uBCF4\uAE30"}
                  </button>
                )}
              </>
            )}
          </section>

          <section>
            <h2 className="text-lg font-bold text-neutral-800 mb-3">{"\uC5EC\uC790 \uBBF8\uB9AC\uBCF4\uAE30"}</h2>
            {females.length === 0 ? (
              <EmptyState />
            ) : (
              <>
                <div className="grid grid-cols-1 gap-3">
                  {females.map((card) => (
                    <FemaleCard key={card.id} card={card} />
                  ))}
                </div>
                {femaleHasMore && (
                  <button
                    type="button"
                    onClick={() => void loadMoreFemale()}
                    disabled={loadingMoreFemale}
                    className="mt-3 w-full min-h-[44px] rounded-xl border border-neutral-300 bg-white text-sm font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-50"
                  >
                    {loadingMoreFemale ? "Loading..." : "\uB354 \uBCF4\uAE30"}
                  </button>
                )}
              </>
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
        {"\uC544\uC9C1 \uACF5\uAC1C\uB41C \uCE74\uB4DC\uAC00 \uC5C6\uC2B5\uB2C8\uB2E4."}
      </p>
      <p className="text-xs text-neutral-400 mb-4">
        {"\uAD00\uB9AC\uC790 \uD655\uC778 \uD6C4 \uBBF8\uB9AC\uBCF4\uAE30\uC5D0 \uD45C\uC2DC\uB429\uB2C8\uB2E4."}
      </p>
      <Link
        href="/dating/apply"
        className="inline-flex items-center px-4 py-2 rounded-xl bg-pink-500 text-white text-sm font-medium hover:bg-pink-600 active:scale-[0.98] transition-all"
      >
        {"\uC2E0\uCCAD\uD558\uAE30"}
      </Link>
    </div>
  );
}

function MaleCard({ card }: { card: DatingCard }) {
  const maskedIdealType = maskIdealTypeForPreview(card.ideal_type);

  return (
    <Link
      href={`/community/dating/${card.id}`}
      className="rounded-2xl bg-white border border-neutral-200 p-4 hover:border-pink-300 hover:shadow-sm transition-all active:scale-[0.99]"
    >
      <div className="flex items-center gap-2 mb-1">
        <span className="font-semibold text-neutral-900 text-sm">{card.display_nickname}</span>
        <span className="text-xs text-neutral-400">{card.age}y</span>
      </div>
      {card.training_years != null && (
        <p className="text-xs text-neutral-500 mb-1">Training {card.training_years}y</p>
      )}
      {maskedIdealType && (
        <p className="text-xs text-pink-700 mb-1 truncate">{"\uD83D\uDC98 \uC774\uC0C1\uD615:"} {maskedIdealType}</p>
      )}
      <div className="flex items-center gap-2">
        {card.total_3lift != null && (
          <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-rose-100 text-rose-700">
            3-lift {card.total_3lift}kg
          </span>
        )}
        {card.percent_all != null && (
          <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700">
            Top {card.percent_all}% KR
          </span>
        )}
      </div>
    </Link>
  );
}

function FemaleCard({ card }: { card: DatingCard }) {
  const maskedIdealType = maskIdealTypeForPreview(card.ideal_type);

  return (
    <Link
      href={`/community/dating/${card.id}`}
      className="rounded-2xl bg-white border border-neutral-200 p-4 hover:border-pink-300 hover:shadow-sm transition-all active:scale-[0.99]"
    >
      <div className="flex items-center gap-2 mb-1">
        <span className="font-semibold text-neutral-900 text-sm">{card.display_nickname}</span>
        <span className="text-xs text-neutral-400">{card.age}y</span>
      </div>
      {card.training_years != null && (
        <p className="text-xs text-neutral-500 mb-1">Training {card.training_years}y</p>
      )}
      {maskedIdealType && (
        <p className="text-xs text-pink-700 mb-1 truncate">{"\uD83D\uDC98 \uC774\uC0C1\uD615:"} {maskedIdealType}</p>
      )}
    </Link>
  );
}
