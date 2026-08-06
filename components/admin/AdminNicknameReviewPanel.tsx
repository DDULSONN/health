"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { normalizeNickname, validateNickname } from "@/lib/nickname";

type ReviewStatus = "pending" | "dismissed" | "actioned" | "cleared";

type ReviewItem = {
  id: string;
  user_id: string;
  nickname: string;
  suspicion_level: "medium" | "high";
  flags: string[];
  status: ReviewStatus;
  first_detected_at: string;
  last_detected_at: string;
  reviewed_at: string | null;
  resolution_note: string | null;
  is_banned: boolean;
  banned_reason: string | null;
};

type ReviewPayload = {
  items?: ReviewItem[];
  total?: number;
  error?: string;
  scannedCount?: number;
  suspiciousCount?: number;
  newlyPendingCount?: number;
};

const STATUS_LABELS: Record<ReviewStatus | "all", string> = {
  pending: "검수 대기",
  dismissed: "문제 없음",
  actioned: "조치 완료",
  cleared: "자동 해제",
  all: "전체",
};

function formatDate(value: string | null) {
  return value ? new Date(value).toLocaleString("ko-KR") : "-";
}

export default function AdminNicknameReviewPanel() {
  const [items, setItems] = useState<ReviewItem[]>([]);
  const [total, setTotal] = useState(0);
  const [status, setStatus] = useState<ReviewStatus | "all">("pending");
  const [query, setQuery] = useState("");
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [savingId, setSavingId] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const loadItems = useCallback(async (nextStatus: ReviewStatus | "all" = status) => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/admin/users/nickname-review?status=${nextStatus}`, { cache: "no-store" });
      const payload = (await response.json().catch(() => ({}))) as ReviewPayload;
      if (!response.ok) throw new Error(payload.error ?? "닉네임 검수 목록을 불러오지 못했습니다.");
      const nextItems = payload.items ?? [];
      setItems(nextItems);
      setTotal(payload.total ?? nextItems.length);
      setDrafts(Object.fromEntries(nextItems.map((item) => [item.id, item.nickname])));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "닉네임 검수 목록을 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, [status]);

  useEffect(() => {
    void loadItems(status);
  }, [loadItems, status]);

  const filteredItems = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return items;
    return items.filter((item) =>
      [item.nickname, item.user_id, ...(item.flags ?? [])].some((value) =>
        String(value).toLowerCase().includes(normalized)
      )
    );
  }, [items, query]);

  const markReview = async (item: ReviewItem, nextStatus: ReviewStatus, note: string) => {
    const response = await fetch("/api/admin/users/nickname-review", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: item.id, status: nextStatus, note }),
    });
    const payload = (await response.json().catch(() => ({}))) as ReviewPayload;
    if (!response.ok) throw new Error(payload.error ?? "검수 상태를 저장하지 못했습니다.");

    if (status === "pending" && nextStatus !== "pending") {
      setItems((current) => current.filter((candidate) => candidate.id !== item.id));
      setTotal((current) => Math.max(0, current - 1));
    } else {
      setItems((current) =>
        current.map((candidate) => (candidate.id === item.id ? { ...candidate, status: nextStatus } : candidate))
      );
    }
  };

  const runScan = async () => {
    if (scanning) return;
    setScanning(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/admin/users/nickname-review", { method: "POST" });
      const payload = (await response.json().catch(() => ({}))) as ReviewPayload;
      if (!response.ok) throw new Error(payload.error ?? "닉네임 전체 검수에 실패했습니다.");
      setNotice(
        `전체 ${payload.scannedCount ?? 0}명 검사, 의심 ${payload.suspiciousCount ?? 0}명, 새 검수 ${payload.newlyPendingCount ?? 0}명`
      );
      if (status !== "pending") setStatus("pending");
      else await loadItems("pending");
    } catch (scanError) {
      setError(scanError instanceof Error ? scanError.message : "닉네임 전체 검수에 실패했습니다.");
    } finally {
      setScanning(false);
    }
  };

  const updateNickname = async (item: ReviewItem) => {
    if (savingId) return;
    const nickname = normalizeNickname(drafts[item.id] ?? "");
    const validationMessage = validateNickname(nickname);
    if (validationMessage) {
      setError(validationMessage);
      return;
    }
    if (nickname === item.nickname) {
      setError("현재 닉네임과 다른 닉네임을 입력해 주세요.");
      return;
    }

    setSavingId(item.id);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/admin/users/nickname", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identifier: item.user_id, nickname }),
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "닉네임을 수정하지 못했습니다.");
      await markReview(item, "actioned", `닉네임을 '${nickname}'으로 수정`);
      setNotice(`'${item.nickname}' 닉네임을 '${nickname}'으로 수정했습니다.`);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "닉네임을 수정하지 못했습니다.");
    } finally {
      setSavingId("");
    }
  };

  const banUser = async (item: ReviewItem) => {
    if (savingId || item.is_banned) return;
    if (!window.confirm(`${item.nickname} 회원을 밴 처리할까요? 공개 중인 카드도 함께 내려갑니다.`)) return;

    setSavingId(item.id);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/admin/users/ban", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: item.user_id,
          banned: true,
          reason: `부적절한 닉네임 검수: ${item.flags.join(", ")}`,
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "회원을 밴 처리하지 못했습니다.");
      await markReview(item, "actioned", "부적절한 닉네임으로 회원 밴 처리");
      setNotice(`${item.nickname} 회원을 밴 처리했습니다.`);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "회원을 밴 처리하지 못했습니다.");
    } finally {
      setSavingId("");
    }
  };

  const dismissItem = async (item: ReviewItem) => {
    if (savingId) return;
    setSavingId(item.id);
    setError("");
    setNotice("");
    try {
      await markReview(item, "dismissed", "관리자 확인 결과 문제 없음");
      setNotice(`${item.nickname} 닉네임을 문제 없음으로 처리했습니다.`);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "검수 상태를 저장하지 못했습니다.");
    } finally {
      setSavingId("");
    }
  };

  return (
    <div className="mb-4 border-y border-violet-200 bg-white px-3 py-4 sm:px-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-violet-950">닉네임 자동 검수</p>
          <p className="mt-1 max-w-2xl text-xs leading-5 text-neutral-500">
            연락처, SNS 계정, 욕설이 의심되는 닉네임을 매일 오전 12시 15분에 전체 검사합니다. 자동 밴은 하지 않습니다.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => void loadItems(status)}
            disabled={loading || scanning}
            className="min-h-[40px] rounded-md border border-neutral-300 bg-white px-3 text-xs font-semibold text-neutral-700 disabled:opacity-50"
          >
            새로고침
          </button>
          <button
            type="button"
            onClick={() => void runScan()}
            disabled={loading || scanning}
            className="min-h-[40px] rounded-md bg-violet-700 px-3 text-xs font-semibold text-white disabled:opacity-50"
          >
            {scanning ? "전체 검사 중..." : "지금 전체 검사"}
          </button>
        </div>
      </div>

      <div className="mt-4 flex gap-2 overflow-x-auto pb-1">
        {(["pending", "actioned", "dismissed", "cleared", "all"] as const).map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => setStatus(value)}
            className={`min-h-[38px] shrink-0 rounded-md border px-3 text-xs font-semibold ${
              status === value
                ? "border-violet-700 bg-violet-700 text-white"
                : "border-neutral-300 bg-white text-neutral-700"
            }`}
          >
            {STATUS_LABELS[value]}
          </button>
        ))}
      </div>

      <div className="mt-3 flex items-center gap-2">
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="닉네임, 사유, 사용자 ID 검색"
          className="min-h-[44px] min-w-0 flex-1 rounded-md border border-neutral-300 px-3 text-sm outline-none focus:border-violet-500"
        />
        <span className="shrink-0 text-xs font-medium text-neutral-500">{total}건</span>
      </div>

      {notice ? <p className="mt-3 rounded-md bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-800">{notice}</p> : null}
      {error ? <p className="mt-3 rounded-md bg-rose-50 px-3 py-2 text-xs font-medium text-rose-700">{error}</p> : null}

      <div className="mt-4 divide-y divide-neutral-200 border-y border-neutral-200">
        {loading ? <p className="py-8 text-center text-sm text-neutral-500">검수 목록을 불러오는 중입니다.</p> : null}
        {!loading && filteredItems.length === 0 ? (
          <p className="py-8 text-center text-sm text-neutral-500">해당 상태의 닉네임이 없습니다.</p>
        ) : null}

        {filteredItems.map((item) => {
          const saving = savingId === item.id;
          return (
            <article key={item.id} className="py-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <strong className="break-all text-base text-neutral-950">{item.nickname}</strong>
                    <span
                      className={`rounded px-2 py-1 text-[11px] font-semibold ${
                        item.suspicion_level === "high"
                          ? "bg-rose-100 text-rose-700"
                          : "bg-amber-100 text-amber-800"
                      }`}
                    >
                      {item.suspicion_level === "high" ? "강한 의심" : "확인 필요"}
                    </span>
                    {item.is_banned ? <span className="rounded bg-neutral-900 px-2 py-1 text-[11px] font-semibold text-white">밴 완료</span> : null}
                  </div>
                  <p className="mt-1 break-all text-[11px] text-neutral-400">{item.user_id}</p>
                </div>
                <p className="text-[11px] text-neutral-500">최근 감지 {formatDate(item.last_detected_at)}</p>
              </div>

              <div className="mt-3 flex flex-wrap gap-1.5">
                {(item.flags ?? []).map((flag) => (
                  <span key={flag} className="rounded bg-rose-50 px-2 py-1 text-[11px] font-medium text-rose-700">
                    {flag}
                  </span>
                ))}
              </div>

              {item.status === "pending" ? (
                <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                  <input
                    value={drafts[item.id] ?? item.nickname}
                    onChange={(event) => setDrafts((current) => ({ ...current, [item.id]: event.target.value }))}
                    maxLength={12}
                    aria-label={`${item.nickname} 수정 닉네임`}
                    className="min-h-[44px] min-w-0 flex-1 rounded-md border border-neutral-300 px-3 text-sm outline-none focus:border-violet-500"
                  />
                  <button
                    type="button"
                    onClick={() => void updateNickname(item)}
                    disabled={Boolean(savingId)}
                    className="min-h-[44px] rounded-md border border-violet-300 bg-violet-50 px-4 text-xs font-semibold text-violet-800 disabled:opacity-50"
                  >
                    {saving ? "처리 중..." : "닉네임 수정"}
                  </button>
                  <button
                    type="button"
                    onClick={() => void dismissItem(item)}
                    disabled={Boolean(savingId)}
                    className="min-h-[44px] rounded-md border border-neutral-300 bg-white px-4 text-xs font-semibold text-neutral-700 disabled:opacity-50"
                  >
                    문제 없음
                  </button>
                  <button
                    type="button"
                    onClick={() => void banUser(item)}
                    disabled={Boolean(savingId) || item.is_banned}
                    className="min-h-[44px] rounded-md border border-rose-300 bg-white px-4 text-xs font-semibold text-rose-700 disabled:opacity-50"
                  >
                    {item.is_banned ? "밴 완료" : "회원 밴"}
                  </button>
                </div>
              ) : (
                <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-neutral-500">
                  <span>{STATUS_LABELS[item.status]}</span>
                  {item.resolution_note ? <span>· {item.resolution_note}</span> : null}
                  {item.reviewed_at ? <span>· {formatDate(item.reviewed_at)}</span> : null}
                </div>
              )}
            </article>
          );
        })}
      </div>

      {total > 500 ? (
        <p className="mt-3 text-[11px] text-amber-700">최근 500건만 표시됩니다. 처리 후 새로고침하면 다음 항목이 이어서 표시됩니다.</p>
      ) : null}
    </div>
  );
}
