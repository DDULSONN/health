"use client";

import { useCallback, useEffect, useState } from "react";

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

export default function AdminDatingCardsPage() {
  const [cards, setCards] = useState<AdminCard[]>([]);
  const [reports, setReports] = useState<AdminReport[]>([]);
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
      if (!cardsRes.ok) throw new Error(cardsBody.error ?? "Failed to load cards");
      if (!reportsRes.ok) throw new Error(reportsBody.error ?? "Failed to load reports");
      setCards(cardsBody.items ?? []);
      setReports(reportsBody.items ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    queueMicrotask(() => {
      void load();
    });
  }, [load]);

  const updateCardStatus = async (id: string, status: "pending" | "public" | "expired" | "hidden") => {
    const res = await fetch(`/api/admin/dating/cards/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) {
      alert(body.error ?? "Failed to update card status");
      return;
    }
    setCards((prev) => prev.map((card) => (card.id === id ? { ...card, status } : card)));
  };

  const updateReportStatus = async (id: string, status: "open" | "resolved" | "dismissed") => {
    const res = await fetch(`/api/admin/dating/reports/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) {
      alert(body.error ?? "Failed to update report status");
      return;
    }
    setReports((prev) => prev.map((report) => (report.id === id ? { ...report, status } : report)));
  };

  return (
    <main className="max-w-5xl mx-auto px-4 py-6">
      <h1 className="text-2xl font-bold text-neutral-900 mb-4">오픈카드 모더레이션</h1>

      {loading ? (
        <p className="text-neutral-500">불러오는 중...</p>
      ) : error ? (
        <p className="text-red-600">{error}</p>
      ) : (
        <>
          <section className="mb-8">
            <h2 className="text-lg font-semibold text-neutral-900 mb-3">카드 전체 내용</h2>
            <div className="space-y-3">
              {cards.map((card) => (
                <div key={card.id} className="rounded-xl border border-neutral-200 bg-white p-3">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-semibold text-neutral-900">
                      {card.display_nickname || "(닉네임 없음)"} / {card.sex === "male" ? "남자" : "여자"} / 상태: {card.status}
                    </p>
                    <span className="text-xs text-neutral-500">{new Date(card.created_at).toLocaleString("ko-KR")}</span>
                  </div>

                  <p className="mt-1 text-xs text-neutral-700 break-all">card_id: {card.id}</p>
                  <p className="mt-1 text-xs text-neutral-700 break-all">owner_user_id: {card.owner_user_id}</p>
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
                    <p className="mt-2 text-xs text-neutral-700 whitespace-pre-wrap break-words">이상형: {card.ideal_type}</p>
                  )}

                  {card.blur_thumb_path && (
                    <p className="mt-1 text-xs text-neutral-500 break-all">blur_thumb_path: {card.blur_thumb_path}</p>
                  )}
                  <p className="mt-1 text-xs text-neutral-500 break-all">
                    photo_paths: {Array.isArray(card.photo_paths) ? card.photo_paths.join(", ") : "-"}
                  </p>

                  {card.published_at && (
                    <p className="mt-1 text-xs text-emerald-700">공개 시작: {new Date(card.published_at).toLocaleString("ko-KR")}</p>
                  )}
                  {card.expires_at && (
                    <p className="mt-1 text-xs text-amber-700">만료 예정: {new Date(card.expires_at).toLocaleString("ko-KR")}</p>
                  )}

                  <div className="mt-2 flex gap-2">
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
                  </div>
                </div>
              ))}
              {cards.length === 0 && <p className="text-sm text-neutral-500">카드가 없습니다.</p>}
            </div>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-neutral-900 mb-3">신고</h2>
            <div className="space-y-3">
              {reports.map((report) => (
                <div key={report.id} className="rounded-xl border border-neutral-200 bg-white p-3">
                  <p className="text-sm font-medium text-neutral-900">카드: {report.card_id}</p>
                  <p className="text-sm text-neutral-700 mt-1 whitespace-pre-wrap">{report.reason}</p>
                  <p className="text-xs text-neutral-500 mt-1">{new Date(report.created_at).toLocaleString("ko-KR")}</p>
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
