"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

type StatusFilter = "pending" | "approved" | "rejected";

type MoreViewRequestItem = {
  id: string;
  user_id: string;
  nickname: string | null;
  sex: "male" | "female";
  status: StatusFilter;
  created_at: string;
  reviewed_at: string | null;
  note: string | null;
};

type CityViewRequestItem = {
  id: string;
  user_id: string;
  nickname: string | null;
  city: string;
  status: StatusFilter;
  created_at: string;
  reviewed_at: string | null;
  note: string | null;
};

export default function AdminDatingMoreViewPage() {
  const [status, setStatus] = useState<StatusFilter>("pending");
  const [moreViewItems, setMoreViewItems] = useState<MoreViewRequestItem[]>([]);
  const [cityViewItems, setCityViewItems] = useState<CityViewRequestItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [actingId, setActingId] = useState<string>("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [moreRes, cityRes] = await Promise.all([
        fetch(`/api/admin/dating/cards/more-view/requests?status=${status}`, { cache: "no-store" }),
        fetch(`/api/admin/dating/cards/city-view/requests?status=${status}`, { cache: "no-store" }),
      ]);

      const moreBody = (await moreRes.json().catch(() => ({}))) as {
        items?: MoreViewRequestItem[];
        message?: string;
      };
      const cityBody = (await cityRes.json().catch(() => ({}))) as {
        items?: CityViewRequestItem[];
        message?: string;
      };

      if (!moreRes.ok) throw new Error(moreBody.message ?? "이상형 더보기 신청 목록을 불러오지 못했습니다.");
      if (!cityRes.ok) throw new Error(cityBody.message ?? "내 가까운 이상형 신청 목록을 불러오지 못했습니다.");

      setMoreViewItems(Array.isArray(moreBody.items) ? moreBody.items : []);
      setCityViewItems(Array.isArray(cityBody.items) ? cityBody.items : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "알 수 없는 오류");
    } finally {
      setLoading(false);
    }
  }, [status]);

  useEffect(() => {
    queueMicrotask(() => {
      void load();
    });
  }, [load]);

  const processMoreView = async (requestId: string, nextStatus: "approved" | "rejected") => {
    setActingId(requestId);
    try {
      const res = await fetch(`/api/admin/dating/cards/more-view/requests/${requestId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: nextStatus }),
      });
      const body = (await res.json().catch(() => ({}))) as { message?: string };
      if (!res.ok) {
        alert(body.message ?? "처리에 실패했습니다.");
        return;
      }
      setMoreViewItems((prev) => prev.filter((item) => item.id !== requestId));
    } finally {
      setActingId("");
    }
  };

  const processCityView = async (requestId: string, nextStatus: "approved" | "rejected") => {
    setActingId(requestId);
    try {
      const res = await fetch(`/api/admin/dating/cards/city-view/requests/${requestId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: nextStatus }),
      });
      const body = (await res.json().catch(() => ({}))) as { message?: string };
      if (!res.ok) {
        alert(body.message ?? "처리에 실패했습니다.");
        return;
      }
      setCityViewItems((prev) => prev.filter((item) => item.id !== requestId));
    } finally {
      setActingId("");
    }
  };

  const totalCount = useMemo(() => moreViewItems.length + cityViewItems.length, [moreViewItems.length, cityViewItems.length]);

  return (
    <main className="mx-auto max-w-5xl px-4 py-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold text-neutral-900">이상형 더보기 신청 관리</h1>
        <div className="flex items-center gap-2">
          <Link
            href="/admin/dating/paid"
            className="rounded-md border border-neutral-300 bg-white px-3 py-2 text-xs text-neutral-700 hover:bg-neutral-50"
          >
            유료 요청 관리
          </Link>
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

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value as StatusFilter)}
          className="h-9 rounded-md border border-neutral-300 bg-white px-2 text-sm text-neutral-800"
        >
          <option value="pending">대기만</option>
          <option value="approved">승인만</option>
          <option value="rejected">거절만</option>
        </select>
        <span className="text-sm text-neutral-500">총 {totalCount}건</span>
      </div>

      {loading ? (
        <p className="text-sm text-neutral-500">불러오는 중...</p>
      ) : error ? (
        <p className="text-sm text-red-600">{error}</p>
      ) : (
        <div className="space-y-6">
          <section className="rounded-xl border border-violet-200 bg-violet-50/40 p-3">
            <h2 className="mb-2 text-sm font-semibold text-violet-900">이상형 더보기 신청 {moreViewItems.length}건</h2>
            {moreViewItems.length === 0 ? (
              <p className="text-xs text-neutral-600">해당 상태의 신청이 없습니다.</p>
            ) : (
              <div className="space-y-2">
                {moreViewItems.map((item) => (
                  <div
                    key={item.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-violet-200 bg-white px-3 py-2"
                  >
                    <div className="text-xs text-neutral-700">
                      <p>
                        {item.nickname ?? item.user_id.slice(0, 8)} / {item.sex === "male" ? "남성 카드" : "여성 카드"}
                      </p>
                      <p className="text-neutral-500">신청일 {new Date(item.created_at).toLocaleString("ko-KR")} / ID {item.id}</p>
                    </div>
                    {status === "pending" ? (
                      <div className="flex gap-2">
                        <button
                          type="button"
                          disabled={actingId === item.id}
                          onClick={() => void processMoreView(item.id, "approved")}
                          className="h-8 rounded-md bg-emerald-600 px-3 text-xs font-medium text-white disabled:opacity-50"
                        >
                          승인
                        </button>
                        <button
                          type="button"
                          disabled={actingId === item.id}
                          onClick={() => void processMoreView(item.id, "rejected")}
                          className="h-8 rounded-md bg-rose-600 px-3 text-xs font-medium text-white disabled:opacity-50"
                        >
                          거절
                        </button>
                      </div>
                    ) : (
                      <span className="text-xs text-neutral-500">
                        처리일 {item.reviewed_at ? new Date(item.reviewed_at).toLocaleString("ko-KR") : "-"}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="rounded-xl border border-emerald-200 bg-emerald-50/40 p-3">
            <h2 className="mb-2 text-sm font-semibold text-emerald-900">내 가까운 이상형 신청 {cityViewItems.length}건</h2>
            {cityViewItems.length === 0 ? (
              <p className="text-xs text-neutral-600">해당 상태의 신청이 없습니다.</p>
            ) : (
              <div className="space-y-2">
                {cityViewItems.map((item) => (
                  <div
                    key={item.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-emerald-200 bg-white px-3 py-2"
                  >
                    <div className="text-xs text-neutral-700">
                      <p>
                        {item.nickname ?? item.user_id.slice(0, 8)} / 도시 {item.city}
                      </p>
                      <p className="text-neutral-500">신청일 {new Date(item.created_at).toLocaleString("ko-KR")} / ID {item.id}</p>
                    </div>
                    {status === "pending" ? (
                      <div className="flex gap-2">
                        <button
                          type="button"
                          disabled={actingId === item.id}
                          onClick={() => void processCityView(item.id, "approved")}
                          className="h-8 rounded-md bg-emerald-600 px-3 text-xs font-medium text-white disabled:opacity-50"
                        >
                          승인
                        </button>
                        <button
                          type="button"
                          disabled={actingId === item.id}
                          onClick={() => void processCityView(item.id, "rejected")}
                          className="h-8 rounded-md bg-rose-600 px-3 text-xs font-medium text-white disabled:opacity-50"
                        >
                          거절
                        </button>
                      </div>
                    ) : (
                      <span className="text-xs text-neutral-500">
                        처리일 {item.reviewed_at ? new Date(item.reviewed_at).toLocaleString("ko-KR") : "-"}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      )}
    </main>
  );
}
