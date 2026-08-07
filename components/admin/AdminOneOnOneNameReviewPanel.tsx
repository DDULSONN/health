"use client";

import { useCallback, useEffect, useState } from "react";

type EditableFields = {
  displayName: string;
  job: string;
  region: string;
  intro: string;
  strengths: string;
  ideal: string;
  preferredPartner: string;
  instagramId: string;
};

type ReviewItem = {
  cardId: string;
  userId: string;
  status: string;
  name: string;
  nickname: string;
  age: number | null;
  region: string;
  job: string;
  editLocked: boolean;
  createdAt: string | null;
  level: "medium" | "high";
  flags: string[];
  editableFields: EditableFields;
};

type ReviewResponse = {
  ok?: boolean;
  scannedCount?: number;
  suspiciousCount?: number;
  items?: ReviewItem[];
  message?: string;
  detail?: string;
};

export default function AdminOneOnOneNameReviewPanel() {
  const [items, setItems] = useState<ReviewItem[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState("");
  const [summary, setSummary] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/admin/dating/1on1-name-review", { cache: "no-store" });
      const body = (await res.json().catch(() => ({}))) as ReviewResponse;
      if (!res.ok || body.ok === false) throw new Error([body.message, body.detail].filter(Boolean).join(" ") || "검수에 실패했습니다.");
      const nextItems = body.items ?? [];
      setItems(nextItems);
      setDrafts(Object.fromEntries(nextItems.map((item) => [item.cardId, item.name])));
      setSummary(`${body.scannedCount ?? 0}개 검사 · 이름 의심 ${body.suspiciousCount ?? nextItems.length}개`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "검수에 실패했습니다.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const updateCard = async (item: ReviewItem, action: "update_fields" | "set_one_on_one_edit_lock" | "delete_card") => {
    const key = `${action}:${item.cardId}`;
    if (action === "delete_card" && !window.confirm("이 1대1 카드를 삭제할까요? 삭제 후 복구가 어렵습니다.")) return;
    const nextName = (drafts[item.cardId] ?? item.name).trim();
    if (action === "update_fields" && !nextName) {
      setError("수정할 이름을 입력해 주세요.");
      return;
    }

    setProcessing(key);
    setError("");
    try {
      const res = await fetch("/api/admin/dating/card-ai-review", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          sourceType: "one_on_one",
          cardId: item.cardId,
          locked: action === "set_one_on_one_edit_lock" ? !item.editLocked : undefined,
          fields: action === "update_fields" ? { ...item.editableFields, displayName: nextName } : undefined,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as { ok?: boolean; message?: string; detail?: string; editLocked?: boolean };
      if (!res.ok || body.ok === false) throw new Error([body.message, body.detail].filter(Boolean).join(" ") || "처리에 실패했습니다.");

      if (action === "set_one_on_one_edit_lock") {
        setItems((prev) => prev.map((candidate) => candidate.cardId === item.cardId ? { ...candidate, editLocked: body.editLocked ?? !item.editLocked } : candidate));
      } else {
        await load();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "처리에 실패했습니다.");
    } finally {
      setProcessing("");
    }
  };

  const banUser = async (item: ReviewItem) => {
    if (!item.userId || !window.confirm(`${item.nickname || item.name} 회원을 이용 정지할까요? 공개 중인 카드도 내려갑니다.`)) return;
    const key = `ban:${item.userId}`;
    setProcessing(key);
    setError("");
    try {
      const res = await fetch("/api/admin/users/ban", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: item.userId, banned: true, reason: "1대1 카드 이름에 연락처 또는 외부 계정을 노출함" }),
      });
      const body = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || body.ok === false) throw new Error(body.error || "회원 정지에 실패했습니다.");
      setItems((prev) => prev.filter((candidate) => candidate.userId !== item.userId));
    } catch (err) {
      setError(err instanceof Error ? err.message : "회원 정지에 실패했습니다.");
    } finally {
      setProcessing("");
    }
  };

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-violet-100 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-bold text-violet-950">1대1 카드 이름 검수</p>
            <p className="mt-1 text-xs text-neutral-500">이름 칸의 전화번호, 인스타·카톡 ID, 외부 링크와 SNS 핸들을 별도로 찾습니다.</p>
          </div>
          <button type="button" onClick={() => void load()} disabled={loading || processing !== ""} className="h-9 rounded-lg bg-violet-600 px-4 text-xs font-semibold text-white disabled:opacity-50">
            {loading ? "검사 중..." : "지금 검사"}
          </button>
        </div>
        {summary ? <p className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-700">{summary}</p> : null}
        {error ? <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p> : null}
      </div>

      {!loading && items.length === 0 ? (
        <div className="rounded-xl border border-neutral-200 bg-white p-6 text-center text-sm text-neutral-500">현재 이름 칸에서 발견된 의심 카드가 없습니다.</div>
      ) : null}

      {items.map((item) => (
        <div key={item.cardId} className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <span className={`rounded-full px-2 py-1 text-[11px] font-bold ${item.level === "high" ? "bg-red-50 text-red-700" : "bg-amber-50 text-amber-700"}`}>{item.level === "high" ? "강한 의심" : "확인 필요"}</span>
                <span className="text-xs text-neutral-500">{item.status}</span>
                {item.editLocked ? <span className="rounded-full bg-neutral-100 px-2 py-1 text-[11px] font-semibold text-neutral-600">사용자 수정 잠금</span> : null}
              </div>
              <p className="mt-2 text-base font-bold text-neutral-950">이름: {item.name || "(비어 있음)"}</p>
              <p className="mt-1 text-xs text-neutral-600">닉네임: {item.nickname || "-"} · {item.age ? `${item.age}세 · ` : ""}{item.region || "지역 없음"} · {item.job || "직업 없음"}</p>
              <p className="mt-1 break-all text-[11px] text-neutral-400">card {item.cardId} / user {item.userId || "-"}</p>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {item.flags.map((flag) => <span key={flag} className="rounded-full bg-red-50 px-2.5 py-1 text-[11px] font-medium text-red-700">{flag}</span>)}
            </div>
          </div>

          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            <input
              value={drafts[item.cardId] ?? item.name}
              onChange={(event) => setDrafts((prev) => ({ ...prev, [item.cardId]: event.target.value }))}
              maxLength={80}
              className="h-10 min-w-0 flex-1 rounded-lg border border-neutral-200 bg-white px-3 text-sm outline-none focus:border-violet-400"
              aria-label={`${item.nickname || item.name} 1대1 이름 수정`}
            />
            <button type="button" onClick={() => void updateCard(item, "update_fields")} disabled={processing !== ""} className="h-10 rounded-lg bg-violet-600 px-4 text-xs font-semibold text-white disabled:opacity-50">
              {processing === `update_fields:${item.cardId}` ? "저장 중..." : "이름 수정"}
            </button>
          </div>

          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" onClick={() => void updateCard(item, "set_one_on_one_edit_lock")} disabled={processing !== ""} className="h-9 rounded-lg border border-neutral-200 bg-white px-3 text-xs font-semibold text-neutral-700 disabled:opacity-50">
              {processing === `set_one_on_one_edit_lock:${item.cardId}` ? "처리 중..." : item.editLocked ? "수정 잠금 해제" : "사용자 수정 잠금"}
            </button>
            <button type="button" onClick={() => void updateCard(item, "delete_card")} disabled={processing !== ""} className="h-9 rounded-lg border border-red-200 bg-red-50 px-3 text-xs font-semibold text-red-700 disabled:opacity-50">
              {processing === `delete_card:${item.cardId}` ? "삭제 중..." : "카드 삭제"}
            </button>
            <button type="button" onClick={() => void banUser(item)} disabled={processing !== "" || !item.userId} className="h-9 rounded-lg bg-red-600 px-3 text-xs font-semibold text-white disabled:opacity-50">
              {processing === `ban:${item.userId}` ? "정지 중..." : "회원 정지"}
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
