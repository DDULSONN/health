"use client";

import { useEffect, useState } from "react";

type SourceType = "all" | "open_card" | "paid_card" | "one_on_one";
type SuspicionLevel = "clear" | "low" | "medium" | "high";

type ReviewItem = {
  sourceType?: "open_card" | "paid_card" | "one_on_one";
  source_type?: "open_card" | "paid_card" | "one_on_one";
  cardId?: string;
  card_id?: string;
  userId?: string | null;
  user_id?: string | null;
  status?: string | null;
  card_status?: string | null;
  displayName?: string | null;
  display_name?: string | null;
  age?: number | null;
  region?: string | null;
  previewUrls?: string[];
  texts?: Record<string, string>;
  createdAt?: string | null;
  scanned_at?: string | null;
  review?: {
    suspicionLevel: SuspicionLevel;
    flags: string[];
    summary: string;
    photoFlags: string[];
    textFlags: string[];
  };
  suspicion_level?: SuspicionLevel;
  flags?: string[];
  summary?: string;
  photo_flags?: string[];
  text_flags?: string[];
};

type ScanResponse = {
  ok?: boolean;
  model?: string;
  scannedCount?: number;
  suspiciousCount?: number;
  items?: ReviewItem[];
  message?: string;
  detail?: string;
};

const SOURCE_LABEL: Record<string, string> = {
  open_card: "오픈카드",
  paid_card: "유료카드",
  one_on_one: "1대1",
};

const LEVEL_LABEL: Record<SuspicionLevel, string> = {
  clear: "정상",
  low: "낮음",
  medium: "확인 필요",
  high: "강한 의심",
};

function itemSource(item: ReviewItem) {
  return item.sourceType ?? item.source_type ?? "open_card";
}

function itemCardId(item: ReviewItem) {
  return item.cardId ?? item.card_id ?? "";
}

function itemUserId(item: ReviewItem) {
  return item.userId ?? item.user_id ?? "";
}

function itemStatus(item: ReviewItem) {
  return item.status ?? item.card_status ?? "";
}

function itemDisplayName(item: ReviewItem) {
  return item.displayName ?? item.display_name ?? "이름 없음";
}

function itemReview(item: ReviewItem) {
  return {
    suspicionLevel: item.review?.suspicionLevel ?? item.suspicion_level ?? "low",
    flags: item.review?.flags ?? item.flags ?? [],
    summary: item.review?.summary ?? item.summary ?? "",
    photoFlags: item.review?.photoFlags ?? item.photo_flags ?? [],
    textFlags: item.review?.textFlags ?? item.text_flags ?? [],
  };
}

function levelClass(level: SuspicionLevel) {
  if (level === "high") return "border-red-200 bg-red-50 text-red-700";
  if (level === "medium") return "border-amber-200 bg-amber-50 text-amber-700";
  if (level === "low") return "border-sky-200 bg-sky-50 text-sky-700";
  return "border-neutral-200 bg-neutral-50 text-neutral-600";
}

export default function AdminDatingCardAiReviewPanel() {
  const [source, setSource] = useState<SourceType>("all");
  const [limit, setLimit] = useState("12");
  const [items, setItems] = useState<ReviewItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");

  const loadLatest = async () => {
    setError("");
    try {
      const res = await fetch("/api/admin/dating/card-ai-review", { cache: "no-store" });
      const body = (await res.json().catch(() => ({}))) as ScanResponse;
      if (!res.ok || body.ok === false) throw new Error(body.message || "최근 검수 목록을 불러오지 못했습니다.");
      setItems(body.items ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "최근 검수 목록을 불러오지 못했습니다.");
    }
  };

  useEffect(() => {
    void loadLatest();
  }, []);

  const runScan = async () => {
    setLoading(true);
    setError("");
    setInfo("");
    try {
      const res = await fetch("/api/admin/dating/card-ai-review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source, limit: Number(limit) || 12 }),
      });
      const body = (await res.json().catch(() => ({}))) as ScanResponse;
      if (!res.ok || body.ok === false) {
        throw new Error([body.message, body.detail].filter(Boolean).join(" ") || "AI 검수에 실패했습니다.");
      }
      setItems(body.items ?? []);
      setInfo(
        `${body.scannedCount ?? 0}개 검사, 의심 ${body.suspiciousCount ?? 0}개 표시` +
          (body.model ? ` (${body.model})` : "")
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "AI 검수에 실패했습니다.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-violet-100 bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-sm font-semibold text-violet-900">AI 카드 검수</p>
            <p className="mt-1 text-xs text-neutral-500">
              삭제/거절/벤은 하지 않고, 사진이나 소개글이 수상한 카드만 관리자에게 보여줍니다.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void loadLatest()}
            className="h-9 rounded-xl border border-neutral-200 bg-white px-3 text-xs font-semibold text-neutral-700"
          >
            최근 결과
          </button>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_120px_auto]">
          <select
            value={source}
            onChange={(event) => setSource(event.target.value as SourceType)}
            className="h-11 rounded-xl border border-neutral-200 bg-white px-3 text-sm"
          >
            <option value="all">전체: 오픈/유료/1대1</option>
            <option value="open_card">오픈카드</option>
            <option value="paid_card">유료카드</option>
            <option value="one_on_one">1대1 카드</option>
          </select>
          <input
            value={limit}
            onChange={(event) => setLimit(event.target.value)}
            inputMode="numeric"
            className="h-11 rounded-xl border border-neutral-200 px-3 text-sm"
            placeholder="검사 수"
          />
          <button
            type="button"
            onClick={() => void runScan()}
            disabled={loading}
            className="h-11 rounded-xl bg-black px-5 text-sm font-semibold text-white disabled:opacity-50"
          >
            {loading ? "검수 중..." : "AI 검수 실행"}
          </button>
        </div>

        {info ? <p className="mt-3 rounded-xl bg-emerald-50 px-3 py-2 text-xs text-emerald-700">{info}</p> : null}
        {error ? <p className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p> : null}
      </div>

      {items.length === 0 ? (
        <div className="rounded-2xl border border-neutral-200 bg-white p-6 text-center text-sm text-neutral-500">
          표시할 의심 카드가 없습니다.
        </div>
      ) : (
        <div className="grid gap-3">
          {items.map((item) => {
            const review = itemReview(item);
            const sourceType = itemSource(item);
            const cardId = itemCardId(item);
            return (
              <div key={`${sourceType}-${cardId}`} className="rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm">
                <div className="flex flex-col gap-3 sm:flex-row sm:justify-between">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-full bg-neutral-900 px-2.5 py-1 text-[11px] font-semibold text-white">
                        {SOURCE_LABEL[sourceType] ?? sourceType}
                      </span>
                      <span className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${levelClass(review.suspicionLevel)}`}>
                        {LEVEL_LABEL[review.suspicionLevel]}
                      </span>
                      <span className="text-xs text-neutral-500">{itemStatus(item)}</span>
                    </div>
                    <p className="mt-2 text-sm font-semibold text-neutral-900">
                      {itemDisplayName(item)} {item.age ? `/ ${item.age}세` : ""} {item.region ? `/ ${item.region}` : ""}
                    </p>
                    <p className="mt-1 break-all text-[11px] text-neutral-400">
                      card {cardId} / user {itemUserId(item) || "-"}
                    </p>
                  </div>
                  {item.previewUrls && item.previewUrls.length > 0 ? (
                    <div className="flex gap-2">
                      {item.previewUrls.map((url) => (
                        <img
                          key={url}
                          src={url}
                          alt="검수 사진"
                          className="h-20 w-20 rounded-xl border border-neutral-200 object-cover"
                        />
                      ))}
                    </div>
                  ) : null}
                </div>

                <p className="mt-3 rounded-xl bg-neutral-50 px-3 py-2 text-sm text-neutral-700">
                  {review.summary || "요약 없음"}
                </p>

                {review.flags.length > 0 ? (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {review.flags.map((flag) => (
                      <span key={flag} className="rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-medium text-amber-700">
                        {flag}
                      </span>
                    ))}
                  </div>
                ) : null}

                {item.texts ? (
                  <details className="mt-3 rounded-xl border border-neutral-100 bg-neutral-50 px-3 py-2 text-xs text-neutral-600">
                    <summary className="cursor-pointer font-semibold text-neutral-800">입력 문구 보기</summary>
                    <div className="mt-2 space-y-1">
                      {Object.entries(item.texts).map(([key, value]) =>
                        value ? (
                          <p key={key}>
                            <span className="font-semibold">{key}: </span>
                            {value}
                          </p>
                        ) : null
                      )}
                    </div>
                  </details>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
