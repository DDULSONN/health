"use client";

import Link from "next/link";
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
  card_owner_user_id: string | null;
  card_display_nickname: string | null;
  card_status: string | null;
  reporter_nickname: string | null;
  owner_nickname: string | null;
  owner_is_banned: boolean;
  owner_banned_reason: string | null;
};

type AdminChatReport = {
  id: string;
  thread_id: string;
  source_kind: "open" | "paid" | "swipe";
  source_id: string;
  reporter_user_id: string;
  reporter_nickname: string | null;
  reported_user_id: string;
  reported_nickname: string | null;
  reported_is_banned: boolean;
  reported_banned_reason: string | null;
  reason: string;
  details: string | null;
  status: "open" | "resolved" | "dismissed";
  created_at: string;
  reviewed_at: string | null;
  reviewer_nickname: string | null;
  thread_status: "open" | "closed" | "deleted";
  conversation_excerpt:
    | Array<{
        id?: string;
        sender_id?: string;
        sender_nickname?: string;
        receiver_id?: string;
        receiver_nickname?: string;
        content?: string;
        created_at?: string;
      }>
    | null;
};

type AdminCardSort = "newest" | "oldest" | "pending_first";
type AdminCardFilter = "all" | "public" | "pending" | "hidden" | "expired";

function formatDate(value: string | null) {
  if (!value) return "-";
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return "-";
  return new Date(value).toLocaleString("ko-KR");
}

export default function AdminDatingCardsPage() {
  const [cards, setCards] = useState<AdminCard[]>([]);
  const [reports, setReports] = useState<AdminReport[]>([]);
  const [chatReports, setChatReports] = useState<AdminChatReport[]>([]);
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
      const [cardsRes, reportsRes, chatReportsRes] = await Promise.all([
        fetch("/api/admin/dating/cards?limit=2000", { cache: "no-store" }),
        fetch("/api/admin/dating/reports", { cache: "no-store" }),
        fetch("/api/admin/dating/chat-reports", { cache: "no-store" }),
      ]);

      const cardsBody = (await cardsRes.json().catch(() => ({}))) as {
        items?: AdminCard[];
        error?: string;
      };
      const reportsBody = (await reportsRes.json().catch(() => ({}))) as {
        items?: AdminReport[];
        error?: string;
      };
      const chatReportsBody = (await chatReportsRes.json().catch(() => ({}))) as {
        items?: AdminChatReport[];
        error?: string;
      };

      if (!cardsRes.ok) throw new Error(cardsBody.error ?? "카드 목록을 불러오지 못했습니다.");
      if (!reportsRes.ok) throw new Error(reportsBody.error ?? "신고 목록을 불러오지 못했습니다.");
      if (!chatReportsRes.ok) throw new Error(chatReportsBody.error ?? "채팅 신고 목록을 불러오지 못했습니다.");

      setCards(cardsBody.items ?? []);
      setReports(reportsBody.items ?? []);
      setChatReports(chatReportsBody.items ?? []);
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

  const sortedReports = useMemo(() => {
    const rank: Record<AdminReport["status"], number> = {
      open: 0,
      resolved: 1,
      dismissed: 2,
    };
    return [...reports].sort((a, b) => {
      const statusGap = rank[a.status] - rank[b.status];
      if (statusGap !== 0) return statusGap;
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });
  }, [reports]);

  const sortedChatReports = useMemo(() => {
    const rank: Record<AdminChatReport["status"], number> = {
      open: 0,
      resolved: 1,
      dismissed: 2,
    };
    return [...chatReports].sort((a, b) => {
      const statusGap = rank[a.status] - rank[b.status];
      if (statusGap !== 0) return statusGap;
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });
  }, [chatReports]);

  useEffect(() => {
    const visibleIds = new Set(visibleCards.map((card) => card.id));
    setSelectedCardIds((prev) => prev.filter((id) => visibleIds.has(id)));
  }, [visibleCards]);

  const allVisibleSelected =
    visibleCards.length > 0 && visibleCards.every((card) => selectedCardIds.includes(card.id));

  const openReportCount = reports.filter((report) => report.status === "open").length;
  const openChatReportCount = chatReports.filter((report) => report.status === "open").length;

  const toggleCardSelection = (id: string, checked: boolean) => {
    setSelectedCardIds((prev) => {
      if (checked) {
        if (prev.includes(id)) return prev;
        return [...prev, id];
      }
      return prev.filter((value) => value !== id);
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
      alert(`${failed.length}건 삭제에 실패했습니다. 다시 시도해주세요.`);
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

  const updateChatReportStatus = async (id: string, status: AdminChatReport["status"]) => {
    const res = await fetch(`/api/admin/dating/chat-reports/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) {
      alert(body.error ?? "채팅 신고 상태 변경에 실패했습니다.");
      return;
    }
    setChatReports((prev) =>
      prev.map((report) =>
        report.id === id ? { ...report, status, reviewed_at: new Date().toISOString() } : report
      )
    );
  };

  const banReportedUser = async (reportId: string) => {
    const report = reports.find((item) => item.id === reportId) ?? null;
    if (!report) return;
    if (!report.card_owner_user_id) {
      alert("신고된 카드의 계정을 찾지 못했습니다.");
      return;
    }

    const ownerLabel = report.owner_nickname || report.card_display_nickname || report.card_owner_user_id;
    if (!confirm(`${ownerLabel} 계정을 밴하고 공개/대기 카드도 함께 숨길까요?`)) return;

    const res = await fetch(`/api/admin/dating/reports/${reportId}/ban`, { method: "POST" });
    const body = (await res.json().catch(() => ({}))) as {
      error?: string;
      banned_reason?: string;
    };
    if (!res.ok) {
      alert(body.error ?? "계정 밴 처리에 실패했습니다.");
      return;
    }

    setReports((prev) =>
      prev.map((item) =>
        item.card_owner_user_id === report.card_owner_user_id
          ? {
              ...item,
              owner_is_banned: true,
              owner_banned_reason: body.banned_reason ?? item.owner_banned_reason,
              status: item.status === "open" ? "resolved" : item.status,
            }
          : item
      )
    );

    setCards((prev) =>
      prev.map((card) =>
        card.owner_user_id === report.card_owner_user_id && (card.status === "public" || card.status === "pending")
          ? { ...card, status: "hidden", expires_at: new Date().toISOString() }
          : card
      )
    );

    alert("신고 계정 밴 및 카드 비노출 처리를 완료했습니다.");
  };

  return (
    <main className="mx-auto max-w-5xl px-4 py-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold text-neutral-900">오픈카드 관리자</h1>
          <p className="mt-1 text-sm text-neutral-500">카드 검수, 신고 처리, 계정 제재를 한 번에 관리합니다.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href="/admin/dating/more-view"
            className="rounded-md border border-neutral-300 bg-white px-3 py-2 text-xs text-neutral-700 hover:bg-neutral-50"
          >
            이상형 더보기 요청
          </Link>
          <Link
            href="/admin/dating/paid"
            className="rounded-md border border-violet-300 bg-violet-50 px-3 py-2 text-xs font-medium text-violet-700 hover:bg-violet-100"
          >
            유료 등록 관리
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

      {loading ? (
        <p className="text-neutral-500">불러오는 중...</p>
      ) : error ? (
        <p className="text-red-600">{error}</p>
      ) : (
        <>
          <section className="mb-8">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-lg font-semibold text-neutral-900">카드 전체 관리</h2>
              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={cardFilter}
                  onChange={(e) => setCardFilter(e.target.value as AdminCardFilter)}
                  className="h-8 rounded-md border border-neutral-300 bg-white px-2 text-xs text-neutral-800"
                >
                  <option value="public">공개중만</option>
                  <option value="pending">대기중만</option>
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
                      <div>
                        <p className="text-sm font-semibold text-neutral-900">
                          {card.display_nickname || "(닉네임 없음)"} / {card.sex === "male" ? "남성" : "여성"} / 상태: {card.status}
                        </p>
                        <p className="mt-1 break-all text-xs text-neutral-700">card_id: {card.id}</p>
                        <p className="mt-1 break-all text-xs text-neutral-700">owner_user_id: {card.owner_user_id}</p>
                      </div>
                    </div>
                    <span className="text-xs text-neutral-500">{formatDate(card.created_at)}</span>
                  </div>

                  {card.instagram_id ? <p className="mt-2 text-xs text-violet-700">owner instagram: @{card.instagram_id}</p> : null}

                  <div className="mt-2 flex flex-wrap gap-2 text-xs text-neutral-700">
                    {card.age != null ? <span>나이 {card.age}</span> : null}
                    {card.height_cm != null ? <span>키 {card.height_cm}cm</span> : null}
                    {card.region ? <span>지역 {card.region}</span> : null}
                    {card.job ? <span>직업 {card.job}</span> : null}
                    {card.training_years != null ? <span>운동 {card.training_years}년</span> : null}
                    {card.total_3lift != null ? <span>3대 {card.total_3lift}kg</span> : null}
                    {card.percent_all != null ? <span>상위 {card.percent_all}%</span> : null}
                    <span>3대인증 {card.is_3lift_verified ? "Y" : "N"}</span>
                  </div>

                  {card.ideal_type ? (
                    <p className="mt-2 whitespace-pre-wrap break-words text-xs text-neutral-700">이상형: {card.ideal_type}</p>
                  ) : null}

                  {card.blur_thumb_path ? (
                    <p className="mt-1 break-all text-xs text-neutral-500">blur_thumb_path: {card.blur_thumb_path}</p>
                  ) : null}
                  <p className="mt-1 break-all text-xs text-neutral-500">
                    photo_paths: {Array.isArray(card.photo_paths) ? card.photo_paths.join(", ") : "-"}
                  </p>

                  {card.published_at ? (
                    <p className="mt-1 text-xs text-emerald-700">공개 시작: {formatDate(card.published_at)}</p>
                  ) : null}
                  {card.expires_at ? (
                    <p className="mt-1 text-xs text-amber-700">만료 예정: {formatDate(card.expires_at)}</p>
                  ) : null}

                  <div className="mt-2 flex flex-wrap gap-2">
                    <button
                      onClick={() => void updateCardStatus(card.id, "public")}
                      className="h-8 rounded-md bg-emerald-600 px-3 text-xs text-white"
                    >
                      공개
                    </button>
                    <button
                      onClick={() => void updateCardStatus(card.id, "hidden")}
                      className="h-8 rounded-md bg-neutral-800 px-3 text-xs text-white"
                    >
                      숨김
                    </button>
                    <button
                      onClick={() => void updateCardStatus(card.id, "pending")}
                      className="h-8 rounded-md bg-amber-600 px-3 text-xs text-white"
                    >
                      대기
                    </button>
                    <button
                      onClick={() => void updateCardStatus(card.id, "expired")}
                      className="h-8 rounded-md bg-zinc-600 px-3 text-xs text-white"
                    >
                      만료
                    </button>
                    <button onClick={() => void deleteCard(card.id)} className="h-8 rounded-md bg-rose-700 px-3 text-xs text-white">
                      삭제
                    </button>
                  </div>
                </div>
              ))}

              {visibleCards.length === 0 ? <p className="text-sm text-neutral-500">해당 조건의 카드가 없습니다.</p> : null}
            </div>
          </section>

          <section>
            <div className="mb-3 flex items-center justify-between gap-2">
              <div>
                <h2 className="text-lg font-semibold text-neutral-900">신고 카드</h2>
                <p className="mt-1 text-xs text-neutral-500">신고 사유 확인 후 바로 상태 변경 또는 계정 밴 처리할 수 있습니다.</p>
              </div>
              <span className="rounded-full bg-rose-50 px-2.5 py-1 text-xs font-medium text-rose-700">open {openReportCount}건</span>
            </div>

            <div className="space-y-3">
              {sortedReports.map((report) => (
                <div key={report.id} className="rounded-xl border border-neutral-200 bg-white p-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-medium text-neutral-900">카드: {report.card_display_nickname || report.card_id}</p>
                      <p className="mt-1 break-all text-xs text-neutral-500">card_id: {report.card_id}</p>
                    </div>
                    <span className="inline-flex rounded-full bg-neutral-100 px-2 py-1 text-xs text-neutral-700">상태: {report.status}</span>
                  </div>

                  <div className="mt-3 grid gap-2 rounded-lg border border-neutral-100 bg-neutral-50 p-3 text-xs text-neutral-700 sm:grid-cols-2">
                    <div>
                      <p className="font-medium text-neutral-900">신고자</p>
                      <p className="mt-1">{report.reporter_nickname || "(닉네임 없음)"}</p>
                      <p className="mt-1 break-all text-neutral-500">{report.reporter_user_id}</p>
                    </div>
                    <div>
                      <p className="font-medium text-neutral-900">카드 주인</p>
                      <p className="mt-1">{report.owner_nickname || report.card_display_nickname || "(닉네임 없음)"}</p>
                      <p className="mt-1 break-all text-neutral-500">{report.card_owner_user_id || "-"}</p>
                      <p className="mt-1">카드 상태: {report.card_status || "-"} / 밴 여부: {report.owner_is_banned ? "Y" : "N"}</p>
                      {report.owner_banned_reason ? (
                        <p className="mt-1 whitespace-pre-wrap break-words text-rose-700">밴 사유: {report.owner_banned_reason}</p>
                      ) : null}
                    </div>
                  </div>

                  <p className="mt-3 whitespace-pre-wrap text-sm text-neutral-700">{report.reason}</p>
                  <p className="mt-1 text-xs text-neutral-500">{formatDate(report.created_at)}</p>

                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      onClick={() => void updateReportStatus(report.id, "resolved")}
                      className="h-8 rounded-md bg-emerald-600 px-3 text-xs text-white"
                    >
                      해결
                    </button>
                    <button
                      onClick={() => void updateReportStatus(report.id, "dismissed")}
                      className="h-8 rounded-md bg-neutral-800 px-3 text-xs text-white"
                    >
                      기각
                    </button>
                    <button
                      onClick={() => void updateReportStatus(report.id, "open")}
                      className="h-8 rounded-md bg-amber-600 px-3 text-xs text-white"
                    >
                      다시 열기
                    </button>
                    <button
                      onClick={() => void banReportedUser(report.id)}
                      className="h-8 rounded-md bg-rose-700 px-3 text-xs text-white"
                    >
                      계정 밴
                    </button>
                  </div>
                </div>
              ))}

              {sortedReports.length === 0 ? <p className="text-sm text-neutral-500">접수된 신고가 없습니다.</p> : null}
            </div>
          </section>

          <section className="mt-8">
            <div className="mb-3 flex items-center justify-between gap-2">
              <div>
                <h2 className="text-lg font-semibold text-neutral-900">채팅 신고</h2>
                <p className="mt-1 text-xs text-neutral-500">신고 시점의 최근 대화 스냅샷을 함께 보고 처리할 수 있습니다.</p>
              </div>
              <span className="rounded-full bg-rose-50 px-2.5 py-1 text-xs font-medium text-rose-700">
                open {openChatReportCount}건
              </span>
            </div>

            <div className="space-y-3">
              {sortedChatReports.map((report) => (
                <div key={report.id} className="rounded-xl border border-neutral-200 bg-white p-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-medium text-neutral-900">
                        {report.reported_nickname || "(닉네임 없음)"} · {report.source_kind}
                      </p>
                      <p className="mt-1 break-all text-xs text-neutral-500">thread_id: {report.thread_id}</p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="inline-flex rounded-full bg-neutral-100 px-2 py-1 text-xs text-neutral-700">
                        상태: {report.status}
                      </span>
                      <span className="inline-flex rounded-full bg-neutral-100 px-2 py-1 text-xs text-neutral-700">
                        thread: {report.thread_status}
                      </span>
                    </div>
                  </div>

                  <div className="mt-3 grid gap-2 rounded-lg border border-neutral-100 bg-neutral-50 p-3 text-xs text-neutral-700 sm:grid-cols-2">
                    <div>
                      <p className="font-medium text-neutral-900">신고자</p>
                      <p className="mt-1">{report.reporter_nickname || "(닉네임 없음)"}</p>
                      <p className="mt-1 break-all text-neutral-500">{report.reporter_user_id}</p>
                    </div>
                    <div>
                      <p className="font-medium text-neutral-900">신고 대상</p>
                      <p className="mt-1">{report.reported_nickname || "(닉네임 없음)"}</p>
                      <p className="mt-1 break-all text-neutral-500">{report.reported_user_id}</p>
                      <p className="mt-1">
                        밴 여부: {report.reported_is_banned ? "Y" : "N"}
                        {report.reported_banned_reason ? ` · ${report.reported_banned_reason}` : ""}
                      </p>
                    </div>
                  </div>

                  <div className="mt-3 rounded-lg border border-rose-100 bg-rose-50/60 p-3">
                    <p className="text-xs font-medium text-neutral-900">신고 사유</p>
                    <p className="mt-1 text-sm text-neutral-800">{report.reason}</p>
                    {report.details ? (
                      <>
                        <p className="mt-3 text-xs font-medium text-neutral-900">추가 설명</p>
                        <p className="mt-1 whitespace-pre-wrap break-words text-sm text-neutral-700">{report.details}</p>
                      </>
                    ) : null}
                    <p className="mt-2 text-[11px] text-neutral-500">{formatDate(report.created_at)}</p>
                  </div>

                  <div className="mt-3 rounded-lg border border-neutral-200 bg-neutral-50 p-3">
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <p className="text-xs font-medium text-neutral-900">신고 당시 최근 대화</p>
                      <p className="text-[11px] text-neutral-500">
                        {Array.isArray(report.conversation_excerpt) ? report.conversation_excerpt.length : 0}개 메시지
                      </p>
                    </div>
                    <div className="space-y-2">
                      {Array.isArray(report.conversation_excerpt) && report.conversation_excerpt.length > 0 ? (
                        report.conversation_excerpt.map((message, index) => (
                          <div key={message.id ?? `${report.id}-${index}`} className="rounded-lg bg-white px-3 py-2">
                            <p className="text-[11px] font-medium text-neutral-500">
                              {message.sender_nickname || "익명"} → {message.receiver_nickname || "익명"} ·{" "}
                              {formatDate(message.created_at ?? null)}
                            </p>
                            <p className="mt-1 whitespace-pre-wrap break-words text-sm text-neutral-800">
                              {message.content || "(내용 없음)"}
                            </p>
                          </div>
                        ))
                      ) : (
                        <p className="text-sm text-neutral-500">저장된 대화 스냅샷이 없습니다.</p>
                      )}
                    </div>
                  </div>

                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      onClick={() => void updateChatReportStatus(report.id, "resolved")}
                      className="h-8 rounded-md bg-emerald-600 px-3 text-xs text-white"
                    >
                      해결
                    </button>
                    <button
                      onClick={() => void updateChatReportStatus(report.id, "dismissed")}
                      className="h-8 rounded-md bg-neutral-800 px-3 text-xs text-white"
                    >
                      기각
                    </button>
                    <button
                      onClick={() => void updateChatReportStatus(report.id, "open")}
                      className="h-8 rounded-md bg-amber-600 px-3 text-xs text-white"
                    >
                      다시 열기
                    </button>
                  </div>
                </div>
              ))}

              {sortedChatReports.length === 0 ? <p className="text-sm text-neutral-500">접수된 채팅 신고가 없습니다.</p> : null}
            </div>
          </section>
        </>
      )}
    </main>
  );
}
