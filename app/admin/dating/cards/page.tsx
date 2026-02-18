"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type AdminCard = {
  id: string;
  owner_user_id: string;
  sex: "male" | "female";
  display_nickname: string | null;
  age: number | null;
  region: string | null;
  height_cm: number | null;
  job: string | null;
  training_years: number | null;
  ideal_type: string | null;
  instagram_id: string | null;
  total_3lift: number | null;
  percent_all: number | null;
  is_3lift_verified: boolean;
  photo_paths: string[] | null;
  blur_thumb_path: string | null;
  status: "pending" | "public" | "expired" | "hidden";
  published_at: string | null;
  expires_at: string | null;
  created_at: string;
};

type AdminReport = {
  id: string;
  card_id: string;
  reporter_user_id: string;
  reason: string;
  status: "open" | "resolved" | "dismissed";
  created_at: string;
};

type AdminCardSort = "newest" | "oldest" | "pending_first";
type AdminCardFilter = "all" | "public" | "pending" | "hidden" | "expired";

export default function AdminDatingCardsPage() {
  const [cards, setCards] = useState<AdminCard[]>([]);
  const [reports, setReports] = useState<AdminReport[]>([]);
  const [cardSort, setCardSort] = useState<AdminCardSort>("newest");
  const [cardFilter, setCardFilter] = useState<AdminCardFilter>("public");
  const [selectedCardIds, setSelectedCardIds] = useState<string[]>([]);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [cardsRes, reportsRes] = await Promise.all([
        fetch("/api/admin/dating/cards?limit=100", { cache: "no-store" }),
        fetch("/api/admin/dating/reports", { cache: "no-store" }),
      ]);
      const cardsBody = (await cardsRes.json().catch(() => ({}))) as { items?: AdminCard[]; error?: string };
      const reportsBody = (await reportsRes.json().catch(() => ({}))) as { items?: AdminReport[]; error?: string };
      if (!cardsRes.ok) throw new Error(cardsBody.error ?? "카드 목록을 불러오지 못했습니다.");
      if (!reportsRes.ok) throw new Error(reportsBody.error ?? "신고 목록을 불러오지 못했습니다.");
      setCards(cardsBody.items ?? []);
      setReports(reportsBody.items ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "알 수 없는 오류가 발생했습니다.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    queueMicrotask(() => {
      void load();
    });
  }, [load]);

  const visibleCards = useMemo(() => {
    const base = cards.filter((card) => (cardFilter === "all" ? true : card.status === cardFilter));
    const pendingFirstRank: Record<AdminCard["status"], number> = {
      pending: 0,
      public: 1,
      hidden: 2,
      expired: 3,
    };
    return [...base].sort((a, b) => {
      if (cardSort === "newest") {
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      }
      if (cardSort === "oldest") {
        return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
      }
      const rankGap = pendingFirstRank[a.status] - pendingFirstRank[b.status];
      if (rankGap !== 0) return rankGap;
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });
  }, [cards, cardFilter, cardSort]);

  useEffect(() => {
    const visibleIds = new Set(visibleCards.map((card) => card.id));
    setSelectedCardIds((prev) => prev.filter((id) => visibleIds.has(id)));
  }, [visibleCards]);

  const allVisibleSelected = visibleCards.length > 0 && visibleCards.every((card) => selectedCardIds.includes(card.id));

  const toggleCardSelection = (id: string, checked: boolean) => {
    setSelectedCardIds((prev) => {
      if (checked) {
        if (prev.includes(id)) return prev;
        return [...prev, id];
      }
      return prev.filter((v) => v !== id);
    });
  };

  const toggleAllVisibleSelection = (checked: boolean) => {
    if (!checked) {
      setSelectedCardIds((prev) => prev.filter((id) => !visibleCards.some((card) => card.id === id)));
      return;
    }
    setSelectedCardIds((prev) => {
      const next = new Set(prev);
      visibleCards.forEach((card) => next.add(card.id));
      return [...next];
    });
  };

  const updateCardStatus = async (id: string, status: AdminCard["status"]) => {
    const res = await fetch(`/api/admin/dating/cards/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) {
      alert(body.error ?? "카드 상태 변경에 실패했습니다.");
      return;
    }
    setCards((prev) => prev.map((card) => (card.id === id ? { ...card, status } : card)));
  };

  const deleteCards = async (ids: string[]) => {
    const results = await Promise.allSettled(
      ids.map(async (id) => {
        const res = await fetch(`/api/admin/dating/cards/${id}`, { method: "DELETE" });
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        if (!res.ok) {
          throw new Error(body.error ?? `카드 삭제 실패: ${id}`);
        }
        return id;
      })
    );

    const deletedIds: string[] = [];
    const failed: string[] = [];

    results.forEach((result, index) => {
      if (result.status === "fulfilled") {
        deletedIds.push(result.value);
      } else {
        failed.push(ids[index]);
      }
    });

    if (deletedIds.length > 0) {
      setCards((prev) => prev.filter((card) => !deletedIds.includes(card.id)));
      setSelectedCardIds((prev) => prev.filter((id) => !deletedIds.includes(id)));
    }

    if (failed.length > 0) {
      alert(`${failed.length}개 삭제 실패. 다시 시도해주세요.`);
    }
  };

  const deleteCard = async (id: string) => {
    if (!confirm("이 카드를 삭제할까요?")) return;
    await deleteCards([id]);
  };

  const deleteSelectedCards = async () => {
    if (selectedCardIds.length === 0) return;
    if (!confirm(`선택한 ${selectedCardIds.length}개 카드를 삭제할까요?`)) return;
    setBulkDeleting(true);
    try {
      await deleteCards(selectedCardIds);
    } finally {
      setBulkDeleting(false);
    }
  };

  const updateReportStatus = async (id: string, status: AdminReport["status"]) => {
    const res = await fetch(`/api/admin/dating/reports/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) {
      alert(body.error ?? "신고 상태 변경에 실패했습니다.");
      return;
    }
    setReports((prev) => prev.map((report) => (report.id === id ? { ...report, status } : report)));
  };

  return (
    <main className="mx-auto max-w-5xl px-4 py-6">
      <h1 className="mb-4 text-2xl font-bold text-neutral-900">오픈카드 모더레이션</h1>

      {loading ? (
        <p className="text-neutral-500">불러오는 중...</p>
      ) : error ? (
        <p className="text-red-600">{error}</p>
      ) : (
        <>
          <section className="mb-8">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-lg font-semibold text-neutral-900">카드 전체 내용</h2>
              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={cardFilter}
                  onChange={(e) => setCardFilter(e.target.value as AdminCardFilter)}
                  className="h-8 rounded-md border border-neutral-300 bg-white px-2 text-xs text-neutral-800"
                >
                  <option value="public">공개중만</option>
                  <option value="pending">대기만</option>
                  <option value="all">전체</option>
                  <option value="hidden">숨김만</option>
                  <option value="expired">만료만</option>
                </select>
                <select
                  value={cardSort}
                  onChange={(e) => setCardSort(e.target.value as AdminCardSort)}
                  className="h-8 rounded-md border border-neutral-300 bg-white px-2 text-xs text-neutral-800"
                >
                  <option value="newest">최신순</option>
                  <option value="oldest">오래된순</option>
                  <option value="pending_first">대기 우선</option>
                </select>
              </div>
            </div>

            <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-neutral-200 bg-neutral-50 p-2">
              <label className="inline-flex items-center gap-2 text-xs text-neutral-700">
                <input
                  type="checkbox"
                  checked={allVisibleSelected}
                  onChange={(e) => toggleAllVisibleSelection(e.target.checked)}
                />
                전체 선택
              </label>
              <span className="text-xs text-neutral-600">선택 {selectedCardIds.length}개</span>
              <button
                type="button"
                onClick={() => void deleteSelectedCards()}
                disabled={selectedCardIds.length === 0 || bulkDeleting}
                className="h-8 rounded-md bg-rose-700 px-3 text-xs text-white disabled:cursor-not-allowed disabled:opacity-50"
              >
                {bulkDeleting ? "삭제 중..." : "선택 삭제"}
              </button>
            </div>

            <div className="space-y-3">
              {visibleCards.map((card) => (
                <div key={card.id} className="rounded-xl border border-neutral-200 bg-white p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-2">
                      <input
                        type="checkbox"
                        checked={selectedCardIds.includes(card.id)}
                        onChange={(e) => toggleCardSelection(card.id, e.target.checked)}
                        className="mt-1"
                      />
                      <p className="text-sm font-semibold text-neutral-900">
                        {card.display_nickname || "(닉네임 없음)"} / {card.sex === "male" ? "남자" : "여자"} / 상태: {card.status}
                      </p>
                    </div>
                    <span className="text-xs text-neutral-500">{new Date(card.created_at).toLocaleString("ko-KR")}</span>
                  </div>

                  <p className="mt-1 break-all text-xs text-neutral-700">card_id: {card.id}</p>
                  <p className="mt-1 break-all text-xs text-neutral-700">owner_user_id: {card.owner_user_id}</p>
                  {card.instagram_id && <p className="mt-1 text-xs text-violet-700">owner instagram: @{card.instagram_id}</p>}

                  <div className="mt-2 flex flex-wrap gap-2 text-xs text-neutral-700">
                    {card.age != null && <span>나이 {card.age}</span>}
                    {card.height_cm != null && <span>키 {card.height_cm}cm</span>}
                    {card.region && <span>지역 {card.region}</span>}
                    {card.job && <span>직업 {card.job}</span>}
                    {card.training_years != null && <span>운동 {card.training_years}년</span>}
                    {card.total_3lift != null && <span>3대 {card.total_3lift}kg</span>}
                    {card.percent_all != null && <span>상위 {card.percent_all}%</span>}
                    <span>3대인증 {card.is_3lift_verified ? "Y" : "N"}</span>
                  </div>

                  {card.ideal_type && (
                    <p className="mt-2 whitespace-pre-wrap break-words text-xs text-neutral-700">이상형: {card.ideal_type}</p>
                  )}

                  {card.blur_thumb_path && (
                    <p className="mt-1 break-all text-xs text-neutral-500">blur_thumb_path: {card.blur_thumb_path}</p>
                  )}
                  <p className="mt-1 break-all text-xs text-neutral-500">
                    photo_paths: {Array.isArray(card.photo_paths) ? card.photo_paths.join(", ") : "-"}
                  </p>

                  {card.published_at && (
                    <p className="mt-1 text-xs text-emerald-700">공개 시작: {new Date(card.published_at).toLocaleString("ko-KR")}</p>
                  )}
                  {card.expires_at && (
                    <p className="mt-1 text-xs text-amber-700">만료 예정: {new Date(card.expires_at).toLocaleString("ko-KR")}</p>
                  )}

                  <div className="mt-2 flex flex-wrap gap-2">
                    <button onClick={() => void updateCardStatus(card.id, "public")} className="h-8 rounded-md bg-emerald-600 px-3 text-xs text-white">
                      공개
                    </button>
                    <button onClick={() => void updateCardStatus(card.id, "hidden")} className="h-8 rounded-md bg-neutral-800 px-3 text-xs text-white">
                      숨김
                    </button>
                    <button onClick={() => void updateCardStatus(card.id, "pending")} className="h-8 rounded-md bg-amber-600 px-3 text-xs text-white">
                      대기
                    </button>
                    <button onClick={() => void updateCardStatus(card.id, "expired")} className="h-8 rounded-md bg-zinc-600 px-3 text-xs text-white">
                      만료
                    </button>
                    <button onClick={() => void deleteCard(card.id)} className="h-8 rounded-md bg-rose-700 px-3 text-xs text-white">
                      삭제
                    </button>
                  </div>
                </div>
              ))}
              {visibleCards.length === 0 && <p className="text-sm text-neutral-500">해당 조건의 카드가 없습니다.</p>}
            </div>
          </section>

          <section>
            <h2 className="mb-3 text-lg font-semibold text-neutral-900">신고</h2>
            <div className="space-y-3">
              {reports.map((report) => (
                <div key={report.id} className="rounded-xl border border-neutral-200 bg-white p-3">
                  <p className="text-sm font-medium text-neutral-900">카드: {report.card_id}</p>
                  <p className="mt-1 whitespace-pre-wrap text-sm text-neutral-700">{report.reason}</p>
                  <p className="mt-1 text-xs text-neutral-500">{new Date(report.created_at).toLocaleString("ko-KR")}</p>
                  <div className="mt-2 flex gap-2">
                    <button onClick={() => void updateReportStatus(report.id, "resolved")} className="h-8 rounded-md bg-emerald-600 px-3 text-xs text-white">
                      해결
                    </button>
                    <button onClick={() => void updateReportStatus(report.id, "dismissed")} className="h-8 rounded-md bg-neutral-800 px-3 text-xs text-white">
                      기각
                    </button>
                    <button onClick={() => void updateReportStatus(report.id, "open")} className="h-8 rounded-md bg-amber-600 px-3 text-xs text-white">
                      재오픈
                    </button>
                    <span className="inline-flex items-center text-xs text-neutral-600">현재: {report.status}</span>
                  </div>
                </div>
              ))}
              {reports.length === 0 && <p className="text-sm text-neutral-500">신고가 없습니다.</p>}
            </div>
          </section>
        </>
      )}
    </main>
  );
}
