"use client";

import { useEffect, useState } from "react";

type SourceType = "all" | "open_card" | "paid_card" | "one_on_one";
type ReviewMode = "rules" | "ai";
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
  raw_result?: { provider?: string; [key: string]: unknown };
  review?: {
    suspicionLevel: SuspicionLevel;
    flags: string[];
    summary: string;
    photoFlags: string[];
    textFlags: string[];
    raw?: { provider?: string; [key: string]: unknown };
  };
  suspicion_level?: SuspicionLevel;
  flags?: string[];
  summary?: string;
  photo_flags?: string[];
  text_flags?: string[];
};

type ScanResponse = {
  ok?: boolean;
  mode?: ReviewMode;
  model?: string;
  scannedCount?: number;
  suspiciousCount?: number;
  items?: ReviewItem[];
  message?: string;
  detail?: string;
};

type ActionResponse = {
  ok?: boolean;
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
    provider: item.review?.raw?.provider ?? item.raw_result?.provider ?? "",
  };
}

function levelClass(level: SuspicionLevel) {
  if (level === "high") return "border-red-200 bg-red-50 text-red-700";
  if (level === "medium") return "border-amber-200 bg-amber-50 text-amber-700";
  if (level === "low") return "border-sky-200 bg-sky-50 text-sky-700";
  return "border-neutral-200 bg-neutral-50 text-neutral-600";
}

function modeLabel(mode: ReviewMode) {
  return mode === "rules" ? "일반 검수" : "AI 검수";
}

export default function AdminDatingCardAiReviewPanel() {
  const [source, setSource] = useState<SourceType>("all");
  const [limit, setLimit] = useState("50");
  const [items, setItems] = useState<ReviewItem[]>([]);
  const [loadingMode, setLoadingMode] = useState<ReviewMode | null>(null);
  const [processingKey, setProcessingKey] = useState("");
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

  const runScan = async (mode: ReviewMode) => {
    setLoadingMode(mode);
    setError("");
    setInfo("");
    try {
      const res = await fetch("/api/admin/dating/card-ai-review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source, limit: Number(limit) || 50, mode }),
      });
      const body = (await res.json().catch(() => ({}))) as ScanResponse;
      if (!res.ok || body.ok === false) {
        throw new Error([body.message, body.detail].filter(Boolean).join(" ") || "카드 검수에 실패했습니다.");
      }
      setItems(body.items ?? []);
      setInfo(
        `${modeLabel(mode)} 완료: ${body.scannedCount ?? 0}개 검사, 의심 ${body.suspiciousCount ?? 0}개 표시` +
          (body.model ? ` (${body.model})` : "")
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "카드 검수에 실패했습니다.");
    } finally {
      setLoadingMode(null);
    }
  };

  const handleAction = async (item: ReviewItem, action: "delete_card" | "send_warning_email") => {
    const sourceType = itemSource(item);
    const cardId = itemCardId(item);
    const review = itemReview(item);
    if (!cardId) return;

    if (action === "delete_card" && !window.confirm("이 의심 카드를 삭제할까요? 삭제 후 복구가 어렵습니다.")) {
      return;
    }

    const key = `${action}:${sourceType}:${cardId}`;
    setProcessingKey(key);
    setError("");
    setInfo("");

    try {
      const res = await fetch("/api/admin/dating/card-ai-review", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          sourceType,
          cardId,
          summary: review.summary,
          flags: review.flags,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as ActionResponse;
      if (!res.ok || body.ok === false) {
        throw new Error([body.message, body.detail].filter(Boolean).join(" ") || "처리에 실패했습니다.");
      }

      if (action === "delete_card") {
        setItems((prev) => prev.filter((candidate) => `${itemSource(candidate)}:${itemCardId(candidate)}` !== `${sourceType}:${cardId}`));
        setInfo("카드를 삭제했습니다.");
      } else {
        setInfo("수정 경고 메일을 보냈습니다.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "처리에 실패했습니다.");
    } finally {
      setProcessingKey("");
    }
  };

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-violet-100 bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-sm font-semibold text-violet-900">카드 검수</p>
            <p className="mt-1 text-xs text-neutral-500">
              일반 검수는 글자수·특정 문장·금칙어만 빠르게 보고, AI 검수는 사진까지 확인합니다. 둘 다 자동 조치는 하지 않습니다.
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
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => void runScan("rules")}
              disabled={loadingMode !== null}
              className="h-11 rounded-xl bg-neutral-900 px-4 text-sm font-semibold text-white disabled:opacity-50"
            >
              {loadingMode === "rules" ? "검수 중..." : "일반 검수"}
            </button>
            <button
              type="button"
              onClick={() => void runScan("ai")}
              disabled={loadingMode !== null}
              className="h-11 rounded-xl bg-violet-600 px-4 text-sm font-semibold text-white disabled:opacity-50"
            >
              {loadingMode === "ai" ? "AI 중..." : "AI 검수"}
            </button>
          </div>
        </div>

        <p className="mt-2 text-[11px] text-neutral-500">
          일반 검수는 비용 없이 빠르게 돌릴 수 있고, AI 검수는 사진/이미지 성격까지 보고 싶을 때만 쓰면 됩니다.
        </p>
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
            const warningKey = `send_warning_email:${sourceType}:${cardId}`;
            const deleteKey = `delete_card:${sourceType}:${cardId}`;
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
                      {review.provider ? (
                        <span className="rounded-full bg-neutral-100 px-2.5 py-1 text-[11px] text-neutral-500">{review.provider}</span>
                      ) : null}
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

                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => void handleAction(item, "send_warning_email")}
                    disabled={processingKey !== "" || !itemUserId(item)}
                    className="h-9 rounded-xl border border-amber-200 bg-amber-50 px-3 text-xs font-semibold text-amber-800 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {processingKey === warningKey ? "메일 발송 중..." : "수정 경고 메일"}
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleAction(item, "delete_card")}
                    disabled={processingKey !== ""}
                    className="h-9 rounded-xl border border-red-200 bg-red-50 px-3 text-xs font-semibold text-red-700 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {processingKey === deleteKey ? "삭제 중..." : "카드 삭제"}
                  </button>
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
