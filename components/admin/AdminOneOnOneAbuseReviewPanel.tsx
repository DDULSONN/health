"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type Finding = {
  cardId: string;
  field: string;
  fieldLabel: string;
  value: string;
  flags: string[];
};

type CardHistory = {
  cardId: string;
  status: string;
  name: string;
  userDeleted: boolean;
  createdAt: string | null;
  updatedAt: string | null;
};

type ReviewItem = {
  userId: string;
  nickname: string;
  isBanned: boolean;
  bannedReason: string;
  level: "high" | "medium";
  score: number;
  registrationCount: number;
  userDeletedCount: number;
  activeCount: number;
  suspiciousCardCount: number;
  duplicateContentCount: number;
  latestCreatedAt: string | null;
  latestCard: {
    cardId: string;
    status: string;
    name: string;
    age: number | null;
    region: string;
    job: string;
  };
  findings: Finding[];
  cards: CardHistory[];
};

type ReviewResponse = {
  ok?: boolean;
  reviewWindowDays?: number;
  scannedCount?: number;
  suspiciousUserCount?: number;
  items?: ReviewItem[];
  message?: string;
  detail?: string;
};

type SortMode = "risk" | "registrations" | "deletions" | "newest";

function dateTime(value: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "-" : date.toLocaleString("ko-KR");
}

export default function AdminOneOnOneAbuseReviewPanel() {
  const [items, setItems] = useState<ReviewItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [processingUserId, setProcessingUserId] = useState("");
  const [summary, setSummary] = useState("");
  const [error, setError] = useState("");
  const [sortMode, setSortMode] = useState<SortMode>("risk");
  const [showBanned, setShowBanned] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/admin/dating/1on1-abuse-review", { cache: "no-store" });
      const body = (await res.json().catch(() => ({}))) as ReviewResponse;
      if (!res.ok || body.ok === false) {
        throw new Error([body.message, body.detail].filter(Boolean).join(" ") || "검수 목록을 불러오지 못했습니다.");
      }
      const nextItems = body.items ?? [];
      setItems(nextItems);
      setSummary(
        `최근 ${body.reviewWindowDays ?? 30}일 · ${body.scannedCount ?? 0}개 카드 검사 · 반복 악용 의심 ${body.suspiciousUserCount ?? nextItems.length}명`
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "검수 목록을 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const visibleItems = useMemo(() => {
    const next = items.filter((item) => showBanned || !item.isBanned);
    next.sort((a, b) => {
      if (sortMode === "registrations") return b.registrationCount - a.registrationCount || b.score - a.score;
      if (sortMode === "deletions") return b.userDeletedCount - a.userDeletedCount || b.score - a.score;
      if (sortMode === "newest") {
        return String(b.latestCreatedAt ?? "").localeCompare(String(a.latestCreatedAt ?? ""));
      }
      return b.score - a.score || b.registrationCount - a.registrationCount;
    });
    return next;
  }, [items, showBanned, sortMode]);

  const banUser = async (item: ReviewItem) => {
    const label = item.nickname || item.latestCard.name || item.userId;
    if (!window.confirm(`${label} 회원을 반복 등록 악용으로 이용 정지할까요?`)) return;

    setProcessingUserId(item.userId);
    setError("");
    try {
      const res = await fetch("/api/admin/users/ban", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: item.userId,
          banned: true,
          reason: "1:1 신청서에 외부 연락처를 기재하고 반복 등록·내리기로 노출을 악용함",
        }),
      });
      const body = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || body.ok === false) throw new Error(body.error || "회원 정지에 실패했습니다.");
      setItems((prev) =>
        prev.map((candidate) =>
          candidate.userId === item.userId
            ? {
                ...candidate,
                isBanned: true,
                bannedReason: "1:1 신청서에 외부 연락처를 기재하고 반복 등록·내리기로 노출을 악용함",
              }
            : candidate
        )
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "회원 정지에 실패했습니다.");
    } finally {
      setProcessingUserId("");
    }
  };

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-violet-100 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-sm font-bold text-violet-950">1:1 반복 등록 악용 검수</p>
            <p className="mt-1 max-w-2xl text-xs leading-5 text-neutral-500">
              외부 계정·연락처를 적은 뒤 신청서를 반복해서 등록하고 내리는 회원을 사용자 단위로 모아봅니다.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading || processingUserId !== ""}
            className="h-9 rounded-lg bg-violet-600 px-4 text-xs font-semibold text-white disabled:opacity-50"
          >
            {loading ? "검사 중..." : "지금 검사"}
          </button>
        </div>
        {summary ? <p className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-700">{summary}</p> : null}
        {error ? <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p> : null}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <label className="text-xs font-semibold text-neutral-600" htmlFor="one-on-one-abuse-sort">정렬</label>
          <select
            id="one-on-one-abuse-sort"
            value={sortMode}
            onChange={(event) => setSortMode(event.target.value as SortMode)}
            className="h-9 rounded-lg border border-neutral-200 bg-white px-3 text-xs text-neutral-800"
          >
            <option value="risk">위험도순</option>
            <option value="registrations">등록 횟수순</option>
            <option value="deletions">내리기 횟수순</option>
            <option value="newest">최근 활동순</option>
          </select>
          <label className="inline-flex h-9 items-center gap-2 rounded-lg border border-neutral-200 bg-white px-3 text-xs text-neutral-700">
            <input type="checkbox" checked={showBanned} onChange={(event) => setShowBanned(event.target.checked)} />
            정지 완료 포함
          </label>
        </div>
      </div>

      {!loading && visibleItems.length === 0 ? (
        <div className="rounded-xl border border-neutral-200 bg-white p-6 text-center text-sm text-neutral-500">
          현재 확인할 반복 등록 악용 의심 회원이 없습니다.
        </div>
      ) : null}

      {visibleItems.map((item) => (
        <article key={item.userId} className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className={`rounded-full px-2 py-1 text-[11px] font-bold ${item.level === "high" ? "bg-red-50 text-red-700" : "bg-amber-50 text-amber-700"}`}>
                  {item.level === "high" ? "강한 의심" : "반복 확인"}
                </span>
                {item.isBanned ? <span className="rounded-full bg-neutral-900 px-2 py-1 text-[11px] font-bold text-white">정지 완료</span> : null}
              </div>
              <p className="mt-2 text-base font-bold text-neutral-950">
                {item.nickname || "닉네임 없음"} · 1:1 이름 {item.latestCard.name || "-"}
              </p>
              <p className="mt-1 text-xs text-neutral-600">
                {item.latestCard.age ? `${item.latestCard.age}세 · ` : ""}{item.latestCard.region || "지역 없음"} · {item.latestCard.job || "직업 없음"}
              </p>
              <p className="mt-1 break-all text-[11px] text-neutral-400">user {item.userId}</p>
            </div>
            <div className="grid grid-cols-2 gap-1.5 text-center text-[11px] sm:grid-cols-4">
              <span className="rounded-lg bg-violet-50 px-2 py-1.5 font-semibold text-violet-700">등록 {item.registrationCount}회</span>
              <span className="rounded-lg bg-rose-50 px-2 py-1.5 font-semibold text-rose-700">내리기 {item.userDeletedCount}회</span>
              <span className="rounded-lg bg-amber-50 px-2 py-1.5 font-semibold text-amber-700">연락처 의심 {item.suspiciousCardCount}장</span>
              <span className="rounded-lg bg-sky-50 px-2 py-1.5 font-semibold text-sky-700">동일 내용 {item.duplicateContentCount}회</span>
            </div>
          </div>

          {item.findings.length > 0 ? (
            <div className="mt-3 space-y-2">
              {item.findings.map((finding, index) => (
                <div key={`${finding.cardId}:${finding.field}:${index}`} className="rounded-lg border border-red-100 bg-red-50/50 px-3 py-2">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-[11px] font-bold text-red-800">{finding.fieldLabel}</span>
                    {finding.flags.map((flag) => <span key={flag} className="rounded-full bg-white px-2 py-0.5 text-[10px] font-medium text-red-700">{flag}</span>)}
                  </div>
                  <p className="mt-1 whitespace-pre-wrap break-words text-xs leading-5 text-neutral-800">{finding.value}</p>
                </div>
              ))}
            </div>
          ) : null}

          <details className="mt-3 rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2">
            <summary className="cursor-pointer text-xs font-semibold text-neutral-700">최근 카드 이력 {item.cards.length}건 보기</summary>
            <div className="mt-2 divide-y divide-neutral-200">
              {item.cards.map((card) => (
                <div key={card.cardId} className="py-2 text-[11px] text-neutral-600">
                  <p className="font-semibold text-neutral-800">{card.name || "이름 없음"} · {card.status}{card.userDeleted ? " · 회원이 내림" : ""}</p>
                  <p className="mt-0.5">등록 {dateTime(card.createdAt)} · 최근 변경 {dateTime(card.updatedAt)}</p>
                </div>
              ))}
            </div>
          </details>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void navigator.clipboard.writeText(item.userId)}
              className="h-9 rounded-lg border border-neutral-200 bg-white px-3 text-xs font-semibold text-neutral-700"
            >
              회원 ID 복사
            </button>
            <button
              type="button"
              onClick={() => void banUser(item)}
              disabled={processingUserId !== "" || item.isBanned}
              className="h-9 rounded-lg bg-red-600 px-3 text-xs font-semibold text-white disabled:opacity-50"
            >
              {processingUserId === item.userId ? "정지 중..." : item.isBanned ? "정지 완료" : "회원 정지"}
            </button>
            <span className="text-[11px] text-neutral-400">최근 등록 {dateTime(item.latestCreatedAt)} · 활성 카드 {item.activeCount}장</span>
          </div>
          {item.isBanned && item.bannedReason ? <p className="mt-2 text-[11px] text-rose-600">정지 사유: {item.bannedReason}</p> : null}
        </article>
      ))}
    </div>
  );
}
