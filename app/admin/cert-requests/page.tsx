"use client";

import { useEffect, useState } from "react";

type Status = "pending" | "needs_info" | "approved" | "rejected";

type CertRequest = {
  id: string;
  submit_code: string;
  nickname: string | null;
  email: string | null;
  sex: "male" | "female";
  bodyweight: number | null;
  squat: number;
  bench: number;
  deadlift: number;
  total: number;
  status: Status;
  note: string | null;
  admin_note: string | null;
  created_at: string;
  reviewed_at: string | null;
};

const STATUSES: Status[] = ["pending", "needs_info", "approved", "rejected"];

export default function AdminCertRequestsPage() {
  const [status, setStatus] = useState<Status>("pending");
  const [items, setItems] = useState<CertRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [note, setNote] = useState<Record<string, string>>({});
  const [error, setError] = useState("");

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/admin/cert-requests?status=${status}`, { cache: "no-store" });
      const body = (await response.json().catch(() => ({}))) as { error?: string; requests?: CertRequest[] };
      if (!response.ok) throw new Error(body.error ?? "요청 목록을 불러오지 못했습니다.");
      setItems(body.requests ?? []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
      setItems([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  const act = async (id: string, action: "approve" | "reject" | "needs-info") => {
    const payload = note[id] ? { admin_note: note[id] } : {};
    const response = await fetch(`/api/admin/cert-requests/${id}/${action}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    if (!response.ok) {
      alert(body.error ?? "처리에 실패했습니다.");
      return;
    }
    await load();
  };

  return (
    <main className="max-w-4xl mx-auto px-4 py-8">
      <h1 className="text-2xl font-bold text-neutral-900 mb-4">인증 신청 관리</h1>
      <div className="flex flex-wrap gap-2 mb-4">
        {STATUSES.map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => setStatus(value)}
            className={`px-3 h-9 rounded-lg text-sm border ${
              status === value ? "bg-neutral-900 text-white border-neutral-900" : "bg-white text-neutral-700 border-neutral-300"
            }`}
          >
            {value}
          </button>
        ))}
      </div>

      {loading && <p className="text-sm text-neutral-500">불러오는 중...</p>}
      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="space-y-3">
        {!loading &&
          items.map((item) => (
            <div key={item.id} className="rounded-xl border border-neutral-200 bg-white p-4">
              <p className="text-sm font-semibold text-neutral-900">{item.submit_code}</p>
              <p className="text-xs text-neutral-500 mt-1">
                {item.nickname ?? "닉네임 없음"} / {item.email ?? "-"} / {item.sex} / 합계 {item.total}kg
              </p>
              <p className="text-xs text-neutral-500 mt-1">
                S {item.squat} / B {item.bench} / D {item.deadlift}
                {item.bodyweight ? ` / BW ${item.bodyweight}` : ""}
              </p>
              {item.note && <p className="text-xs text-neutral-600 mt-2">신청 메모: {item.note}</p>}
              {item.admin_note && <p className="text-xs text-amber-700 mt-2">메모: {item.admin_note}</p>}

              <textarea
                value={note[item.id] ?? ""}
                onChange={(event) => setNote((prev) => ({ ...prev, [item.id]: event.target.value }))}
                rows={2}
                placeholder="관리자 메모"
                className="w-full mt-2 rounded-lg border border-neutral-300 px-2 py-1 text-sm"
              />

              <div className="flex flex-wrap gap-2 mt-2">
                <button
                  type="button"
                  onClick={() => act(item.id, "approve")}
                  className="px-3 h-9 rounded-lg bg-emerald-600 text-white text-sm"
                >
                  Approve
                </button>
                <button
                  type="button"
                  onClick={() => act(item.id, "needs-info")}
                  className="px-3 h-9 rounded-lg bg-amber-500 text-white text-sm"
                >
                  Needs Info
                </button>
                <button
                  type="button"
                  onClick={() => act(item.id, "reject")}
                  className="px-3 h-9 rounded-lg bg-red-600 text-white text-sm"
                >
                  Reject
                </button>
              </div>
            </div>
          ))}
      </div>
    </main>
  );
}
