"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

type AdminSupportItem = {
  id: string;
  user_id: string | null;
  nickname: string | null;
  category: string;
  subject: string;
  message: string;
  contact_email: string | null;
  contact_phone: string | null;
  status: "open" | "answered" | "closed";
  admin_reply: string | null;
  created_at: string;
  answered_at: string | null;
};

const STATUS_LABELS: Record<AdminSupportItem["status"], string> = {
  open: "접수",
  answered: "답변 완료",
  closed: "종결",
};

export default function AdminSupportPage() {
  const supabase = useMemo(() => createClient(), []);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [items, setItems] = useState<AdminSupportItem[]>([]);
  const [statusFilter, setStatusFilter] = useState<"" | AdminSupportItem["status"]>("");
  const [savingIds, setSavingIds] = useState<string[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  const loadItems = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const qs = statusFilter ? `?status=${encodeURIComponent(statusFilter)}` : "";
      const res = await fetch(`/api/admin/support${qs}`, { cache: "no-store" });
      const body = (await res.json().catch(() => ({}))) as { items?: AdminSupportItem[]; error?: string };
      if (!res.ok) {
        throw new Error(body.error ?? "문의 목록을 불러오지 못했습니다.");
      }
      setItems(Array.isArray(body.items) ? body.items : []);
      setDrafts(Object.fromEntries((body.items ?? []).map((item) => [item.id, item.admin_reply ?? ""])));
    } catch (e) {
      setError(e instanceof Error ? e.message : "문의 목록을 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    let mounted = true;
    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        window.location.href = "/login?redirect=/admin/support";
        return;
      }
      if (!mounted) return;
      await loadItems();
    })();
    return () => {
      mounted = false;
    };
  }, [loadItems, supabase]);

  const handleSave = async (item: AdminSupportItem, status: AdminSupportItem["status"]) => {
    setSavingIds((prev) => [...prev, item.id]);
    setError("");
    try {
      const res = await fetch("/api/admin/support", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: item.id,
          status,
          admin_reply: drafts[item.id] ?? "",
        }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        throw new Error(body.error ?? "문의 저장에 실패했습니다.");
      }
      await loadItems();
    } catch (e) {
      setError(e instanceof Error ? e.message : "문의 저장에 실패했습니다.");
    } finally {
      setSavingIds((prev) => prev.filter((id) => id !== item.id));
    }
  };

  return (
    <main className="mx-auto max-w-4xl px-4 py-8">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-neutral-900">고객 문의 관리</p>
          <p className="mt-1 text-xs text-neutral-500">
            결제, 소개팅, 신고/악용 관련 문의를 여기서 답변하고 종결할 수 있습니다.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href="/mypage"
            className="rounded-lg border border-neutral-300 bg-white px-3 py-2 text-xs font-medium text-neutral-700"
          >
            마이페이지
          </Link>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as "" | AdminSupportItem["status"])}
            className="rounded-lg border border-neutral-300 bg-white px-3 py-2 text-xs text-neutral-700"
          >
            <option value="">전체 상태</option>
            <option value="open">접수</option>
            <option value="answered">답변 완료</option>
            <option value="closed">종결</option>
          </select>
        </div>
      </div>

      {error && <p className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}

      {loading ? (
        <p className="text-sm text-neutral-500">불러오는 중...</p>
      ) : items.length === 0 ? (
        <p className="rounded-xl border border-neutral-200 bg-white p-4 text-sm text-neutral-500">접수된 문의가 없습니다.</p>
      ) : (
        <div className="space-y-4">
          {items.map((item) => {
            const saving = savingIds.includes(item.id);
            return (
              <div key={item.id} className="rounded-2xl border border-neutral-200 bg-white p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-neutral-900">{item.subject}</p>
                    <p className="mt-1 text-xs text-neutral-500">
                      {item.nickname ?? item.user_id?.slice(0, 8) ?? "탈퇴 사용자"} / {item.category} /{" "}
                      {new Date(item.created_at).toLocaleString("ko-KR")}
                    </p>
                    <p className="mt-1 text-xs text-neutral-500">
                      연락처: {item.contact_email ?? "-"} {item.contact_phone ? `/ ${item.contact_phone}` : ""}
                    </p>
                  </div>
                  <span className="rounded-full bg-neutral-100 px-3 py-1 text-xs font-medium text-neutral-700">
                    {STATUS_LABELS[item.status]}
                  </span>
                </div>

                <p className="mt-3 whitespace-pre-wrap break-words text-sm text-neutral-700">{item.message}</p>

                <textarea
                  value={drafts[item.id] ?? ""}
                  onChange={(e) => setDrafts((prev) => ({ ...prev, [item.id]: e.target.value }))}
                  rows={4}
                  placeholder="운영자 답변"
                  className="mt-4 w-full rounded-xl border border-neutral-300 px-3 py-2 text-sm text-neutral-800"
                />

                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => void handleSave(item, "answered")}
                    className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-medium text-white disabled:opacity-50"
                  >
                    답변 완료 저장
                  </button>
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => void handleSave(item, "closed")}
                    className="rounded-lg border border-neutral-300 bg-white px-3 py-2 text-xs font-medium text-neutral-700 disabled:opacity-50"
                  >
                    종결 처리
                  </button>
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => void handleSave(item, "open")}
                    className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800 disabled:opacity-50"
                  >
                    다시 접수 상태로
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </main>
  );
}
