"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ADMIN_OPERATION_ROWS, type AdminOperationCounts } from "@/lib/admin-operations";

type Summary = { counts: AdminOperationCounts; checkedAt: string };
const formatTime = new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", hour: "numeric", minute: "2-digit" });

export default function AdminOperationsPanel() {
  const [request, setRequest] = useState(0);
  const [result, setResult] = useState<{ request: number; data: Summary | null } | null>(null);
  const current = result?.request === request ? result : null;
  const summary = current?.data ?? null;

  useEffect(() => {
    const controller = new AbortController();
    let disposed = false;
    const timeout = window.setTimeout(() => controller.abort(), 10_000);
    void fetch("/api/admin/operations", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("operations");
        const data: Summary = await response.json();
        if (!data.counts || !Number.isFinite(Date.parse(data.checkedAt))) throw new Error("invalid summary");
        if (!disposed) setResult({ request, data });
      })
      .catch(() => { if (!disposed) setResult({ request, data: null }); })
      .finally(() => window.clearTimeout(timeout));
    return () => { disposed = true; window.clearTimeout(timeout); controller.abort(); };
  }, [request]);

  return (
    <section aria-labelledby="admin-operations-title" className="mb-5 rounded-2xl border border-neutral-200 bg-white p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 id="admin-operations-title" className="text-lg font-bold text-neutral-900">오늘 처리할 일</h2>
          <p className="mt-1 text-sm text-neutral-600">대기 건수만 표시해요. 처리나 결제는 여기서 실행되지 않아요.</p>
        </div>
        <button type="button" disabled={!current} onClick={() => setRequest((value) => value + 1)}
          className="min-h-11 rounded-xl border border-neutral-300 px-3 text-sm font-medium disabled:opacity-60">다시 확인</button>
      </div>
      {!current ? (
        <p role="status" className="mt-3 text-sm text-neutral-600">업무 건수를 확인하고 있어요.</p>
      ) : !summary ? (
        <p role="alert" className="mt-3 text-sm text-red-700">건수를 불러오지 못했어요. 다시 확인해 주세요.</p>
      ) : (
        <>
          <p role="status" className="mt-3 text-xs text-neutral-600">{formatTime.format(new Date(summary.checkedAt))} 기준</p>
          <ul className="mt-2 grid gap-2 sm:grid-cols-2">
            {ADMIN_OPERATION_ROWS.map((row) => {
              const count = summary.counts[row.key];
              return (
                <li key={row.key} className="min-w-0">
                  <Link href={row.href} prefetch={false} className="block rounded-xl border border-neutral-200 p-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2">
                    <div className="flex items-start justify-between gap-3">
                      <span className="font-semibold text-neutral-900">{row.label}</span>
                      <span className="shrink-0 text-sm tabular-nums text-neutral-700">
                        {typeof count === "number" ? `${count.toLocaleString("ko-KR")}${row.unit}` : "확인 필요"}
                      </span>
                    </div>
                    <p className="mt-1 text-xs leading-5 text-neutral-600">{row.hint}</p>
                  </Link>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </section>
  );
}
