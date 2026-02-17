"use client";

import { useCallback, useEffect, useState } from "react";

type AdminCard = {
  id: string;
  owner_user_id: string;
  sex: "male" | "female";
  age: number | null;
  region: string | null;
  training_years: number | null;
  total_3lift: number | null;
  percent_all: number | null;
  status: "pending" | "public" | "hidden";
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

  const updateCardStatus = async (id: string, status: "pending" | "public" | "hidden") => {
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
      <h1 className="text-2xl font-bold text-neutral-900 mb-4">Dating Cards Moderation</h1>

      {loading ? (
        <p className="text-neutral-500">Loading...</p>
      ) : error ? (
        <p className="text-red-600">{error}</p>
      ) : (
        <>
          <section className="mb-8">
            <h2 className="text-lg font-semibold text-neutral-900 mb-3">Cards</h2>
            <div className="space-y-3">
              {cards.map((card) => (
                <div key={card.id} className="rounded-xl border border-neutral-200 bg-white p-3">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-medium text-neutral-900">
                      {card.sex} / {card.age ?? "-"} / {card.region ?? "-"} / owner: {card.owner_user_id.slice(0, 8)}...
                    </p>
                    <span className="text-xs text-neutral-500">{new Date(card.created_at).toLocaleString("ko-KR")}</span>
                  </div>
                  <div className="mt-2 flex gap-2">
                    <button onClick={() => void updateCardStatus(card.id, "public")} className="h-8 rounded-md bg-emerald-600 px-3 text-xs text-white">
                      Public
                    </button>
                    <button onClick={() => void updateCardStatus(card.id, "hidden")} className="h-8 rounded-md bg-neutral-800 px-3 text-xs text-white">
                      Hidden
                    </button>
                    <button onClick={() => void updateCardStatus(card.id, "pending")} className="h-8 rounded-md bg-amber-600 px-3 text-xs text-white">
                      Pending
                    </button>
                    <span className="inline-flex items-center text-xs text-neutral-600">Current: {card.status}</span>
                  </div>
                </div>
              ))}
              {cards.length === 0 && <p className="text-sm text-neutral-500">No cards.</p>}
            </div>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-neutral-900 mb-3">Reports</h2>
            <div className="space-y-3">
              {reports.map((report) => (
                <div key={report.id} className="rounded-xl border border-neutral-200 bg-white p-3">
                  <p className="text-sm font-medium text-neutral-900">Card: {report.card_id}</p>
                  <p className="text-sm text-neutral-700 mt-1 whitespace-pre-wrap">{report.reason}</p>
                  <p className="text-xs text-neutral-500 mt-1">{new Date(report.created_at).toLocaleString("ko-KR")}</p>
                  <div className="mt-2 flex gap-2">
                    <button onClick={() => void updateReportStatus(report.id, "resolved")} className="h-8 rounded-md bg-emerald-600 px-3 text-xs text-white">
                      Resolve
                    </button>
                    <button onClick={() => void updateReportStatus(report.id, "dismissed")} className="h-8 rounded-md bg-neutral-800 px-3 text-xs text-white">
                      Dismiss
                    </button>
                    <button onClick={() => void updateReportStatus(report.id, "open")} className="h-8 rounded-md bg-amber-600 px-3 text-xs text-white">
                      Re-open
                    </button>
                    <span className="inline-flex items-center text-xs text-neutral-600">Current: {report.status}</span>
                  </div>
                </div>
              ))}
              {reports.length === 0 && <p className="text-sm text-neutral-500">No reports.</p>}
            </div>
          </section>
        </>
      )}
    </main>
  );
}
