"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

type Item = { id: string; subject: string; nickname: string | null; triage: { reason: string } };
export default function AdminSupportAttention() {
  const [items, setItems] = useState<Item[]>([]);
  const [state, setState] = useState("불러오는 중...");
  const refresh = useCallback(async (signal?: AbortSignal) => {
    setState("불러오는 중...");
    try {
      const res = await fetch("/api/admin/support?view=important", { cache: "no-store", signal });
      if (!res.ok) throw new Error();
      const body = await res.json();
      if (!signal?.aborted) { setItems(body.items ?? []); setState(""); }
    } catch { if (!signal?.aborted) setState("문의 목록을 불러오지 못했습니다. 고객 문의 관리에서 확인해 주세요."); }
  }, []);
  useEffect(() => { const controller = new AbortController(); void refresh(controller.signal); return () => controller.abort(); }, [refresh]);
  return <aside className="mb-5 rounded-xl border border-amber-200 bg-white p-4" aria-label="중요 고객 문의">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h3 className="font-semibold text-amber-900">중요 문의 · 관리자 확인 {state ? "" : `(${items.length}${items.length === 100 ? "+" : ""})`}</h3>
      <div className="flex gap-3 text-sm"><button type="button" onClick={() => void refresh()} className="underline">새로고침</button><Link href="/admin/support" className="font-semibold underline">문의 관리 열기</Link></div>
    </div>
    {state ? <p role="status" className="mt-2 text-sm">{state}</p> : items.length === 0 ? <p className="mt-2 text-sm text-neutral-500">확인이 필요한 접수 문의가 없습니다.</p> : <ul className="mt-3 space-y-2">
      {items.slice(0, 5).map(item => <li key={item.id} className="rounded-lg bg-amber-50 p-3 text-sm"><Link href="/admin/support" className="font-semibold underline">{item.subject}</Link><span className="ml-2 text-xs">{item.nickname ?? "회원"}</span><p className="mt-1 text-xs text-neutral-600">{item.triage.reason}</p></li>)}
    </ul>}
    <p className="mt-2 text-xs text-neutral-500">단순 안내는 자동답변하며, 결제·환불·신고·계정 문제와 처리 지연은 운영자가 확인합니다.</p>
  </aside>;
}
