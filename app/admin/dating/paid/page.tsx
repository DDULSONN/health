"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

type PaidAdminItem = {
  id: string;
  user_id: string;
  nickname: string;
  gender: "M" | "F";
  age: number | null;
  region: string | null;
  height_cm: number | null;
  job: string | null;
  training_years: number | null;
  strengths_text: string | null;
  ideal_text: string | null;
  intro_text: string | null;
  instagram_id: string;
  status: "pending" | "approved" | "rejected" | "expired";
  paid_at: string | null;
  expires_at: string | null;
  created_at: string;
  previewUrl: string;
};

type ApplyCreditOrderItem = {
  id: string;
  user_id: string;
  nickname: string | null;
  pack_size: number;
  amount: number;
  status: "pending" | "approved" | "rejected";
  created_at: string;
  processed_at: string | null;
  memo: string | null;
};

type StatusFilter = "all" | "pending" | "approved" | "rejected" | "expired";

const STATUS_LABEL: Record<PaidAdminItem["status"], string> = {
  pending: "대기",
  approved: "승인",
  rejected: "거절",
  expired: "만료",
};

const STATUS_STYLE: Record<PaidAdminItem["status"], string> = {
  pending: "bg-amber-100 text-amber-700",
  approved: "bg-emerald-100 text-emerald-700",
  rejected: "bg-rose-100 text-rose-700",
  expired: "bg-neutral-200 text-neutral-700",
};

export default function AdminDatingPaidPage() {
  const [items, setItems] = useState<PaidAdminItem[]>([]);
  const [creditOrders, setCreditOrders] = useState<ApplyCreditOrderItem[]>([]);
  const [filter, setFilter] = useState<StatusFilter>("pending");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [actingId, setActingId] = useState<string>("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const qs = filter === "all" ? "" : `?status=${filter}`;
      const [res, ordersRes] = await Promise.all([
        fetch(`/api/admin/dating/paid${qs}`, { cache: "no-store" }),
        fetch("/api/admin/dating/apply-credits/orders?status=pending&limit=100", { cache: "no-store" }),
      ]);

      const body = (await res.json().catch(() => ({}))) as { items?: PaidAdminItem[]; message?: string };
      const ordersBody = (await ordersRes.json().catch(() => ({}))) as {
        items?: ApplyCreditOrderItem[];
        message?: string;
      };

      if (!res.ok) throw new Error(body.message ?? "유료 요청 목록을 불러오지 못했습니다.");
      if (!ordersRes.ok) throw new Error(ordersBody.message ?? "지원권 주문 목록을 불러오지 못했습니다.");

      setItems(Array.isArray(body.items) ? body.items : []);
      setCreditOrders(Array.isArray(ordersBody.items) ? ordersBody.items : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "알 수 없는 오류");
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    queueMicrotask(() => {
      void load();
    });
  }, [load]);

  const handleApprove = async (paidCardId: string) => {
    setActingId(paidCardId);
    try {
      const res = await fetch("/api/admin/dating/paid/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paidCardId }),
      });
      const body = (await res.json().catch(() => ({}))) as { message?: string };
      if (!res.ok) {
        alert(body.message ?? "승인 처리에 실패했습니다.");
        return;
      }
      setItems((prev) =>
        prev.map((item) =>
          item.id === paidCardId
            ? {
                ...item,
                status: "approved",
                paid_at: new Date().toISOString(),
                expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
              }
            : item
        )
      );
    } finally {
      setActingId("");
    }
  };

  const handleReject = async (paidCardId: string) => {
    setActingId(paidCardId);
    try {
      const res = await fetch("/api/admin/dating/paid/reject", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paidCardId }),
      });
      const body = (await res.json().catch(() => ({}))) as { message?: string };
      if (!res.ok) {
        alert(body.message ?? "거절 처리에 실패했습니다.");
        return;
      }
      setItems((prev) =>
        prev.map((item) =>
          item.id === paidCardId
            ? {
                ...item,
                status: "rejected",
                paid_at: null,
                expires_at: null,
              }
            : item
        )
      );
    } finally {
      setActingId("");
    }
  };

  const handleApproveCreditOrder = async (orderId: string) => {
    setActingId(orderId);
    try {
      const res = await fetch("/api/admin/dating/apply-credits/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId }),
      });
      const body = (await res.json().catch(() => ({}))) as { ok?: boolean; message?: string };
      if (!res.ok || !body.ok) {
        alert(body.message ?? "지원권 승인 처리에 실패했습니다.");
        return;
      }
      setCreditOrders((prev) => prev.filter((order) => order.id !== orderId));
    } finally {
      setActingId("");
    }
  };

  const visibleItems = useMemo(() => {
    if (filter === "all") return items;
    return items.filter((item) => item.status === filter);
  }, [items, filter]);

  return (
    <main className="mx-auto max-w-5xl px-4 py-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold text-neutral-900">유료 요청 관리</h1>
        <div className="flex items-center gap-2">
          <Link
            href="/admin/dating/cards"
            className="rounded-md border border-neutral-300 bg-white px-3 py-2 text-xs text-neutral-700 hover:bg-neutral-50"
          >
            오픈카드 모더레이션
          </Link>
          <button
            type="button"
            onClick={() => void load()}
            className="rounded-md border border-neutral-300 bg-white px-3 py-2 text-xs text-neutral-700 hover:bg-neutral-50"
          >
            새로고침
          </button>
        </div>
      </div>

      <section className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50/50 p-3">
        <div className="mb-2 flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-emerald-900">지원권 주문 승인 대기 {creditOrders.length}건</h2>
          <button
            type="button"
            onClick={() => void load()}
            className="rounded-md border border-emerald-300 bg-white px-2 py-1 text-xs text-emerald-800 hover:bg-emerald-50"
          >
            새로고침
          </button>
        </div>
        {creditOrders.length === 0 ? (
          <p className="text-xs text-neutral-600">승인 대기 주문이 없습니다.</p>
        ) : (
          <div className="space-y-2">
            {creditOrders.map((order) => (
              <div key={order.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-emerald-200 bg-white px-2 py-2">
                <div className="text-xs text-neutral-700">
                  <p>
                    {order.nickname ?? order.user_id.slice(0, 8)} / +{order.pack_size}장 / {order.amount.toLocaleString("ko-KR")}원
                  </p>
                  <p className="text-neutral-500">주문ID {order.id} / {new Date(order.created_at).toLocaleString("ko-KR")}</p>
                </div>
                <button
                  type="button"
                  disabled={actingId === order.id}
                  onClick={() => void handleApproveCreditOrder(order.id)}
                  className="h-8 rounded-md bg-emerald-600 px-3 text-xs font-medium text-white disabled:opacity-50"
                >
                  {actingId === order.id ? "처리 중..." : "승인"}
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      <div className="mb-4 flex items-center gap-2">
        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value as StatusFilter)}
          className="h-9 rounded-md border border-neutral-300 bg-white px-2 text-sm text-neutral-800"
        >
          <option value="pending">대기만</option>
          <option value="approved">승인만</option>
          <option value="rejected">거절만</option>
          <option value="expired">만료만</option>
          <option value="all">전체</option>
        </select>
        <span className="text-sm text-neutral-500">총 {visibleItems.length}건</span>
      </div>

      {loading ? (
        <p className="text-sm text-neutral-500">불러오는 중...</p>
      ) : error ? (
        <p className="text-sm text-red-600">{error}</p>
      ) : visibleItems.length === 0 ? (
        <p className="text-sm text-neutral-500">해당 조건의 유료 요청이 없습니다.</p>
      ) : (
        <div className="space-y-3">
          {visibleItems.map((item) => (
            <article key={item.id} className="rounded-xl border border-neutral-200 bg-white p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-semibold text-neutral-900">
                  {item.nickname} / {item.gender === "M" ? "남자" : "여자"}
                </p>
                <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[item.status]}`}>
                  {STATUS_LABEL[item.status]}
                </span>
              </div>

              <p className="mt-1 break-all text-xs text-neutral-500">요청ID: {item.id}</p>
              <p className="mt-1 break-all text-xs text-neutral-500">user_id: {item.user_id}</p>
              <p className="mt-1 text-xs font-medium text-violet-700">인스타: @{item.instagram_id}</p>

              <div className="mt-2 flex flex-wrap gap-2 text-xs text-neutral-700">
                {item.age != null && <span>나이 {item.age}</span>}
                {item.region && <span>지역 {item.region}</span>}
                {item.height_cm != null && <span>키 {item.height_cm}cm</span>}
                {item.job && <span>직업 {item.job}</span>}
                {item.training_years != null && <span>운동 {item.training_years}년</span>}
              </div>

              {item.previewUrl && (
                <div className="mt-3 h-44 w-full overflow-hidden rounded-lg border border-neutral-200 bg-neutral-50">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={item.previewUrl} alt="" className="h-full w-full object-contain" />
                </div>
              )}

              {item.strengths_text && <p className="mt-2 text-xs text-emerald-700">내 장점: {item.strengths_text}</p>}
              {item.ideal_text && <p className="mt-1 text-xs text-rose-700 whitespace-pre-wrap break-words">이상형: {item.ideal_text}</p>}
              {item.intro_text && <p className="mt-1 text-xs text-neutral-700 whitespace-pre-wrap break-words">소개: {item.intro_text}</p>}

              <div className="mt-2 text-xs text-neutral-500">
                <p>요청일: {new Date(item.created_at).toLocaleString("ko-KR")}</p>
                {item.paid_at && <p>승인일: {new Date(item.paid_at).toLocaleString("ko-KR")}</p>}
                {item.expires_at && <p>만료일: {new Date(item.expires_at).toLocaleString("ko-KR")}</p>}
              </div>

              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  disabled={actingId === item.id}
                  onClick={() => void handleApprove(item.id)}
                  className="h-8 rounded-md bg-emerald-600 px-3 text-xs font-medium text-white disabled:opacity-50"
                >
                  승인
                </button>
                <button
                  type="button"
                  disabled={actingId === item.id}
                  onClick={() => void handleReject(item.id)}
                  className="h-8 rounded-md bg-rose-600 px-3 text-xs font-medium text-white disabled:opacity-50"
                >
                  거절
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </main>
  );
}
