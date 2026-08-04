"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import {
  APP_TEST_FEEDBACK_CATEGORY_LABELS,
  APP_TEST_STATUSES,
  APP_TEST_STATUS_LABELS,
  type AppTestFeedbackCategory,
  type AppTestStatus,
} from "@/lib/app-testing";

type FeedbackItem = {
  id: string;
  category: AppTestFeedbackCategory;
  message: string;
  device_model: string | null;
  app_version: string | null;
  created_at: string;
};

type TesterItem = {
  id: string;
  user_id: string;
  play_email: string;
  status: AppTestStatus;
  nickname: string | null;
  created_at: string;
  invited_at: string | null;
  feedback: FeedbackItem[];
};

type AdminPayload = { items?: TesterItem[]; item?: TesterItem; error?: string };

function formatDate(value: string | null) {
  return value ? new Date(value).toLocaleString("ko-KR") : "-";
}

export default function AdminAppTestersPanel() {
  const [items, setItems] = useState<TesterItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState("");
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | AppTestStatus>("all");

  const loadItems = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/admin/app-testers", { cache: "no-store" });
      const payload = (await response.json().catch(() => ({}))) as AdminPayload;
      if (!response.ok) throw new Error(payload.error ?? "앱 테스트 신청자를 불러오지 못했습니다.");
      setItems(payload.items ?? []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "앱 테스트 신청자를 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadItems();
  }, [loadItems]);

  const filteredItems = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return items.filter((item) => {
      if (statusFilter !== "all" && item.status !== statusFilter) return false;
      if (!normalized) return true;
      return [item.nickname, item.play_email, item.user_id].some((value) =>
        String(value ?? "").toLowerCase().includes(normalized)
      );
    });
  }, [items, query, statusFilter]);

  const counts = useMemo(
    () =>
      APP_TEST_STATUSES.reduce<Record<AppTestStatus, number>>(
        (result, status) => ({ ...result, [status]: items.filter((item) => item.status === status).length }),
        { pending: 0, invited: 0, testing: 0, completed: 0 }
      ),
    [items]
  );

  const updateStatus = async (id: string, status: AppTestStatus) => {
    if (savingId) return;
    setSavingId(id);
    setError("");
    try {
      const response = await fetch("/api/admin/app-testers", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, status }),
      });
      const payload = (await response.json().catch(() => ({}))) as AdminPayload;
      if (!response.ok) throw new Error(payload.error ?? "참여 상태를 저장하지 못했습니다.");
      setItems((current) => current.map((item) => (item.id === id ? { ...item, status } : item)));
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "참여 상태를 저장하지 못했습니다.");
    } finally {
      setSavingId("");
    }
  };

  return (
    <div className="mb-4 border-y border-violet-200 bg-white px-3 py-4 sm:px-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-violet-950">Google Play 비공개 테스트</p>
          <p className="mt-1 text-xs text-neutral-500">신청 이메일, 초대 상태와 사용 피드백을 관리합니다.</p>
        </div>
        <button
          type="button"
          onClick={() => void loadItems()}
          disabled={loading}
          className="min-h-[40px] rounded-md border border-violet-200 bg-white px-3 text-xs font-semibold text-violet-800 disabled:opacity-50"
        >
          {loading ? "불러오는 중" : "새로고침"}
        </button>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-px overflow-hidden rounded-md border border-neutral-200 bg-neutral-200 sm:grid-cols-4">
        {APP_TEST_STATUSES.map((status) => (
          <button
            key={status}
            type="button"
            onClick={() => setStatusFilter(statusFilter === status ? "all" : status)}
            className={`min-h-[48px] bg-white px-2 text-left text-xs ${statusFilter === status ? "text-violet-700" : "text-neutral-600"}`}
          >
            <span className="block font-medium">{APP_TEST_STATUS_LABELS[status]}</span>
            <strong className="mt-0.5 block text-base text-neutral-950">{counts[status]}명</strong>
          </button>
        ))}
      </div>

      <div className="mt-3 flex gap-2">
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="닉네임·이메일·사용자 ID 검색"
          className="min-h-[44px] min-w-0 flex-1 rounded-md border border-neutral-300 px-3 text-sm outline-none focus:border-violet-500"
        />
        {statusFilter !== "all" ? (
          <button
            type="button"
            onClick={() => setStatusFilter("all")}
            className="min-h-[44px] shrink-0 rounded-md border border-neutral-300 px-3 text-xs font-medium text-neutral-700"
          >
            전체
          </button>
        ) : null}
      </div>

      {error ? <p className="mt-3 text-xs font-medium text-rose-600">{error}</p> : null}

      <div className="mt-4 divide-y divide-neutral-200 border-y border-neutral-200">
        {!loading && filteredItems.length === 0 ? (
          <p className="py-8 text-center text-sm text-neutral-500">조건에 맞는 신청이 없습니다.</p>
        ) : null}
        {filteredItems.map((item) => (
          <div key={item.id} className="py-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-neutral-950">
                  {item.nickname || "닉네임 없음"} · {item.play_email}
                </p>
                <p className="mt-1 break-all text-[11px] text-neutral-500">
                  신청 {formatDate(item.created_at)} · {item.user_id}
                </p>
                {item.invited_at ? (
                  <p className="mt-1 text-[11px] text-emerald-700">초대 처리 {formatDate(item.invited_at)}</p>
                ) : null}
              </div>
              <div className="flex shrink-0 gap-2">
                <button
                  type="button"
                  onClick={() => void navigator.clipboard.writeText(item.play_email)}
                  className="min-h-[44px] rounded-md border border-neutral-300 px-3 text-xs font-medium text-neutral-700"
                >
                  이메일 복사
                </button>
                <select
                  value={item.status}
                  onChange={(event) => void updateStatus(item.id, event.target.value as AppTestStatus)}
                  disabled={savingId === item.id}
                  className="min-h-[44px] rounded-md border border-violet-300 bg-white px-3 text-xs font-semibold text-violet-800 disabled:opacity-50"
                >
                  {APP_TEST_STATUSES.map((status) => (
                    <option key={status} value={status}>
                      {APP_TEST_STATUS_LABELS[status]}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {item.feedback.length > 0 ? (
              <div className="mt-3 divide-y divide-neutral-100 border-t border-neutral-100">
                {item.feedback.map((feedbackItem) => (
                  <div key={feedbackItem.id} className="py-3 last:pb-0">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px]">
                      <span className="font-semibold text-violet-700">
                        {APP_TEST_FEEDBACK_CATEGORY_LABELS[feedbackItem.category] ?? "피드백"}
                      </span>
                      <span className="text-neutral-400">{formatDate(feedbackItem.created_at)}</span>
                      {feedbackItem.device_model ? <span className="text-neutral-500">{feedbackItem.device_model}</span> : null}
                      {feedbackItem.app_version ? <span className="text-neutral-500">v{feedbackItem.app_version}</span> : null}
                    </div>
                    <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-6 text-neutral-700">
                      {feedbackItem.message}
                    </p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="mt-3 border-t border-neutral-100 pt-3 text-[11px] text-neutral-400">아직 받은 피드백이 없습니다.</p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
