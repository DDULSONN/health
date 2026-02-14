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
  video_url: string | null;
  admin_note: string | null;
  created_at: string;
  reviewed_at: string | null;
  certificates?: Array<{
    id: string;
    certificate_no: string;
    slug: string;
    qr_url: string;
    pdf_url: string;
    issued_at: string;
  }> | null;
};

type ActionErrorBody = {
  error?: string;
  ok?: boolean;
  step?: string;
  message?: string;
  detail?: unknown;
};

const STATUSES: Status[] = ["pending", "needs_info", "approved", "rejected"];

export default function AdminCertReviewPanel() {
  const [status, setStatus] = useState<Status>("pending");
  const [items, setItems] = useState<CertRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [note, setNote] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [actionError, setActionError] = useState<Record<string, string>>({});
  const [actionRaw, setActionRaw] = useState<Record<string, string>>({});

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/admin/cert-requests?status=${status}`, { cache: "no-store" });
      const body = (await response.json().catch(() => ({}))) as {
        error?: string;
        requests?: CertRequest[];
      };

      if (!response.ok) {
        throw new Error(body.error ?? "요청 목록을 불러오지 못했습니다.");
      }

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
    setActionError((prev) => ({ ...prev, [id]: "" }));
    setActionRaw((prev) => ({ ...prev, [id]: "" }));

    const payload = note[id] ? { admin_note: note[id] } : {};
    const response = await fetch(`/api/admin/cert-requests/${id}/${action}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const body = (await response.json().catch(() => ({}))) as ActionErrorBody;
    setActionRaw((prev) => ({ ...prev, [id]: JSON.stringify(body, null, 2) }));

    if (!response.ok) {
      const step = body.step ?? "unknown_step";
      const message = body.message ?? body.error ?? "처리에 실패했습니다.";
      const composed = `[${step}] ${message}`;
      setActionError((prev) => ({ ...prev, [id]: composed }));
      alert(composed);
      return;
    }

    await load();
  };

  return (
    <section className="rounded-2xl border border-neutral-200 bg-white p-4">
      <div className="mb-4 flex flex-wrap gap-2">
        {STATUSES.map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => setStatus(value)}
            className={`h-9 rounded-lg border px-3 text-sm ${
              status === value
                ? "border-neutral-900 bg-neutral-900 text-white"
                : "border-neutral-300 bg-white text-neutral-700"
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
          items.map((item) => {
            const cert = item.certificates?.[0] ?? null;
            return (
              <div key={item.id} className="rounded-xl border border-neutral-200 bg-white p-4">
                {cert ? (
                  <div className="mb-2 rounded-lg border border-emerald-200 bg-emerald-50 p-2 text-xs text-emerald-900">
                    <p>slug: {cert.slug}</p>
                    <p className="break-all">
                      qr_url:{" "}
                      <a href={cert.qr_url} target="_blank" rel="noreferrer" className="underline">
                        {cert.qr_url}
                      </a>
                    </p>
                    <div className="mt-1 flex gap-2">
                      <a
                        href={cert.qr_url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex h-7 items-center rounded bg-neutral-900 px-2 text-white"
                      >
                        검증 페이지 열기
                      </a>
                      <a
                        href={cert.pdf_url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex h-7 items-center rounded bg-emerald-600 px-2 text-white"
                      >
                        PDF 열기
                      </a>
                    </div>
                  </div>
                ) : null}

                <p className="text-sm font-semibold text-neutral-900">submit_code: {item.submit_code}</p>
                <p className="mt-1 text-xs text-neutral-500">
                  신청자: {item.nickname ?? "닉네임 없음"} / 이메일: {item.email ?? "-"}
                </p>
                <p className="mt-1 text-xs text-neutral-500">
                  성별: {item.sex === "male" ? "남성" : "여성"}
                  {item.bodyweight ? ` / 체중: ${item.bodyweight}kg` : ""}
                </p>
                <p className="mt-1 text-xs text-neutral-500">
                  기록: S {item.squat} / B {item.bench} / D {item.deadlift} / 합계 {item.total}kg
                </p>

                {item.video_url ? (
                  <p className="mt-2 text-xs text-neutral-600">
                    영상 링크:{" "}
                    <a href={item.video_url} target="_blank" rel="noreferrer" className="break-all text-blue-600 underline">
                      {item.video_url}
                    </a>
                  </p>
                ) : null}

                {item.note ? <p className="mt-2 text-xs text-neutral-600">신청 메모: {item.note}</p> : null}
                {item.admin_note ? <p className="mt-2 text-xs text-amber-700">관리자 메모: {item.admin_note}</p> : null}
                {actionError[item.id] ? <p className="mt-2 text-xs text-red-600">실패: {actionError[item.id]}</p> : null}

                {actionRaw[item.id] ? (
                  <details className="mt-2 rounded-lg border border-neutral-200 bg-neutral-50 p-2">
                    <summary className="cursor-pointer text-xs text-neutral-700">서버 응답 원문 보기</summary>
                    <pre className="mt-2 overflow-x-auto text-[11px] text-neutral-800">{actionRaw[item.id]}</pre>
                  </details>
                ) : null}

                <textarea
                  value={note[item.id] ?? ""}
                  onChange={(event) => setNote((prev) => ({ ...prev, [item.id]: event.target.value }))}
                  rows={2}
                  placeholder="관리자 메모 입력"
                  className="mt-2 w-full rounded-lg border border-neutral-300 px-2 py-1 text-sm"
                />

                <div className="mt-2 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => act(item.id, "approve")}
                    className="h-9 rounded-lg bg-emerald-600 px-3 text-sm text-white"
                  >
                    승인
                  </button>
                  <button
                    type="button"
                    onClick={() => act(item.id, "needs-info")}
                    className="h-9 rounded-lg bg-amber-500 px-3 text-sm text-white"
                  >
                    추가자료요청
                  </button>
                  <button
                    type="button"
                    onClick={() => act(item.id, "reject")}
                    className="h-9 rounded-lg bg-red-600 px-3 text-sm text-white"
                  >
                    거절
                  </button>
                </div>
              </div>
            );
          })}
      </div>
    </section>
  );
}
