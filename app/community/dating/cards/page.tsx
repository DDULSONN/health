"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

type PublicCard = {
  id: string;
  owner_user_id: string;
  sex: "male" | "female";
  age: number | null;
  region: string | null;
  height_cm: number | null;
  job: string | null;
  training_years: number | null;
  ideal_type: string | null;
  total_3lift: number | null;
  percent_all: number | null;
  is_3lift_verified: boolean;
  created_at: string;
  can_apply: boolean;
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

export default function DatingCardsPage() {
  const [items, setItems] = useState<PublicCard[]>([]);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);

  const load = useCallback(async (nextOffset: number, append: boolean) => {
    const params = new URLSearchParams({
      limit: String(PAGE_SIZE),
      offset: String(nextOffset),
    });
    const res = await fetch(`/api/dating/cards/public?${params.toString()}`);
    if (!res.ok) throw new Error("failed to load cards");
    const data = (await res.json()) as {
      items: PublicCard[];
      hasMore: boolean;
      nextOffset: number;
    };

    setItems((prev) => (append ? [...prev, ...(data.items ?? [])] : data.items ?? []));
    setHasMore(Boolean(data.hasMore));
    setOffset(data.nextOffset ?? nextOffset + (data.items?.length ?? 0));
  }, []);

  useEffect(() => {
    queueMicrotask(async () => {
      setLoading(true);
      try {
        await load(0, false);
      } catch (e) {
        console.error("dating cards load failed", e);
      }
      setLoading(false);
    });
  }, [load]);

  const loadMore = useCallback(async () => {
    if (!hasMore || loadingMore) return;
    setLoadingMore(true);
    try {
      await load(offset, true);
    } catch (e) {
      console.error("dating cards load more failed", e);
    }
    setLoadingMore(false);
  }, [hasMore, loadingMore, load, offset]);

  return (
    <main className="max-w-3xl mx-auto px-4 py-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-neutral-900">{"\uC18C\uAC1C\uD305 \uACF5\uAC1C \uCE74\uB4DC"}</h1>
          <p className="text-sm text-neutral-500 mt-1">{"\uACF5\uAC1C \uCE74\uB4DC\uB97C \uBCF4\uACE0 \uC9C0\uC6D0\uD560 \uC218 \uC788\uC5B4\uC694."}</p>
        </div>
        <Link
          href="/community/dating/cards/new"
          className="inline-flex min-h-[40px] items-center rounded-lg border border-pink-200 bg-pink-50 px-3 text-sm font-medium text-pink-700 hover:bg-pink-100"
        >
          Create Card
        </Link>
      </div>

      {loading ? (
        <p className="text-neutral-400 text-center py-10">Loading...</p>
      ) : items.length === 0 ? (
        <div className="rounded-2xl border border-neutral-200 bg-neutral-50 p-6 text-center">
          <p className="text-sm font-medium text-neutral-700">{"\uD604\uC7AC \uACF5\uAC1C\uB41C \uCE74\uB4DC\uAC00 \uC5C6\uC2B5\uB2C8\uB2E4."}</p>
        </div>
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
              onClick={() => void loadMore()}
              disabled={loadingMore}
              className="mt-4 w-full min-h-[44px] rounded-xl border border-neutral-300 bg-white text-sm font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-50"
            >
              {loadingMore ? "Loading..." : "Load more"}
            </button>
          )}
        </>
      )}
    </main>
  );
}

function CardRow({ card }: { card: PublicCard }) {
  const ideal = maskIdealTypeForPreview(card.ideal_type);

  return (
    <div className="rounded-2xl border border-neutral-200 bg-white p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm text-neutral-700">
          <span className="font-semibold text-neutral-900">{card.sex === "male" ? "Male" : "Female"}</span>
          {card.age != null && <span>{card.age}y</span>}
          {card.region && <span>{card.region}</span>}
        </div>
        <span className="text-xs text-neutral-400">{new Date(card.created_at).toLocaleDateString("ko-KR")}</span>
      </div>

      <div className="mt-2 flex flex-wrap gap-2 text-xs text-neutral-600">
        {card.height_cm != null && <span>{card.height_cm}cm</span>}
        {card.job && <span>{card.job}</span>}
        {card.training_years != null && <span>Training {card.training_years}y</span>}
      </div>

      {ideal && <p className="mt-2 text-xs text-pink-700 truncate">{"\uD83D\uDC98 \uC774\uC0C1\uD615:"} {ideal}</p>}

      {card.sex === "male" && (
        <div className="mt-2 flex flex-wrap gap-2">
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
          {card.is_3lift_verified && (
            <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-700">Verified</span>
          )}
        </div>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        {card.can_apply ? (
          <Link
            href={`/community/dating/cards/${card.id}/apply`}
            className="inline-flex min-h-[40px] items-center rounded-lg bg-pink-500 px-4 text-sm font-medium text-white hover:bg-pink-600"
          >
            Apply
          </Link>
        ) : (
          <span className="inline-flex min-h-[40px] items-center rounded-lg bg-neutral-100 px-4 text-sm text-neutral-600">
            {"\uB0B4 \uCE74\uB4DC"}
          </span>
        )}
        <ReportButton cardId={card.id} />
      </div>
    </div>
  );
}

function ReportButton({ cardId }: { cardId: string }) {
  const onClick = async () => {
    const reason = prompt("Report reason");
    if (!reason?.trim()) return;
    const res = await fetch("/api/dating/cards/report", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ card_id: cardId, reason }),
    });
    if (res.ok) alert("Reported");
    else alert("Report failed");
  };

  return (
    <button
      type="button"
      onClick={() => void onClick()}
      className="inline-flex min-h-[40px] items-center rounded-lg border border-neutral-300 px-4 text-sm text-neutral-700 hover:bg-neutral-50"
    >
      Report
    </button>
  );
}
