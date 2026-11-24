"use client";

import { useEffect, useRef, useState } from "react";
import { fetchClientJson } from "@/lib/client-json-request";
import { CONTACT_CARE_UUID } from "@/lib/contact-care";

const reasons = {
  checkout_pending: "결제 대기 기록",
  payment_history: "승인·취소 이력 확인 필요",
  multiple_orders: "여러 주문 확인 필요",
} as const;
type Reason = keyof typeof reasons;
type Filter = { state: "open" | "resolved" | "all"; reason: "" | Reason; reference: string };
type SupportItem = {
  reference: string;
  memberId: string;
  matchId: string;
  reason: Reason;
  createdAt: string;
  resolvedAt: string | null;
};
type SupportOrder = { orderNumber: string | null; status: string; createdAt: string; approvedAt: string | null };
const orderStatus: Record<string, string> = { ready: "대기", paid: "결제 완료", failed: "실패", canceled: "취소" };
const initialFilter: Filter = { state: "open", reason: "", reference: "" };
const control = "min-h-11 rounded-lg border border-neutral-300 bg-white px-3 text-xs text-neutral-900 disabled:opacity-50";
const dateTime = new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", dateStyle: "short", timeStyle: "short" });

function validItem(row: SupportItem) {
  return !!row && typeof row === "object" && [row.reference, row.memberId, row.matchId].every(id => typeof id === "string" && CONTACT_CARE_UUID.test(id))
    && Object.hasOwn(reasons, row.reason) && Number.isFinite(Date.parse(row.createdAt))
    && (row.resolvedAt === null || Number.isFinite(Date.parse(row.resolvedAt)));
}

function validOrder(row: SupportOrder) {
  return !!row && typeof row === "object" && (row.orderNumber === null || (typeof row.orderNumber === "string" && /^[a-zA-Z0-9_-]{6,64}$/.test(row.orderNumber)))
    && typeof row.status === "string" && /^[a-z_]{1,24}$/.test(row.status) && Number.isFinite(Date.parse(row.createdAt))
    && (row.approvedAt === null || Number.isFinite(Date.parse(row.approvedAt)));
}

export default function AdminCheckoutSupportPanel() {
  const [filter, setFilter] = useState<Filter>(initialFilter);
  const [applied, setApplied] = useState<Filter | null>(null);
  const [items, setItems] = useState<SupportItem[]>([]);
  const [orders, setOrders] = useState<SupportOrder[] | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [busy, setBusy] = useState(false);
  const pending = useRef<AbortController | null>(null);
  useEffect(() => () => pending.current?.abort(), []);

  async function load(input: Filter, cursor?: string) {
    if (pending.current) return;
    const reference = input.reference.trim();
    if (reference && !CONTACT_CARE_UUID.test(reference)) { setError("문의 번호 전체를 확인해 주세요."); return; }
    const controller = new AbortController();
    pending.current = controller; setBusy(true); setError(""); setInfo("");
    try {
      const params = new URLSearchParams({ state: reference ? "all" : input.state, limit: "20" });
      if (input.reason && !reference) params.set("reason", input.reason);
      if (reference) params.set("reference", reference);
      if (cursor) params.set("before", cursor);
      const { response, body } = await fetchClientJson<{ requests: SupportItem[]; nextCursor: string | null; orders?: SupportOrder[] | null; error?: string }>(
        `/api/admin/contact-care/checkout-support?${params}`, { cache: "no-store", signal: controller.signal }, 12000,
      );
      if (controller.signal.aborted) return;
      if (!response.ok || !Array.isArray(body?.requests) || body.requests.length > 20 || !body.requests.every(validItem)
        || !(body.nextCursor === null || (typeof body.nextCursor === "string" && body.nextCursor !== cursor))
        || (body.orders != null && (!reference || !Array.isArray(body.orders) || body.orders.length > 9 || !body.orders.every(validOrder)))) {
        throw Error(body?.error || "지원 요청을 불러오지 못했어요.");
      }
      setItems(previous => cursor ? [...new Map([...previous, ...body.requests].map(row => [row.reference, row])).values()] : body.requests);
      setOrders(reference ? body.orders ?? null : null); setNext(body.nextCursor); setApplied(input);
    } catch (e) {
      if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "지원 요청을 불러오지 못했어요.");
    } finally {
      if (pending.current === controller) pending.current = null;
      if (!controller.signal.aborted) setBusy(false);
    }
  }

  async function resolve(reference: string) {
    if (pending.current) return;
    const controller = new AbortController();
    pending.current = controller; setBusy(true); setError(""); setInfo("");
    try {
      const { response, body } = await fetchClientJson<{ ok?: boolean; reference?: string; resolvedAt?: string; error?: string }>(
        "/api/admin/contact-care/checkout-support", {
          method: "PATCH", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reference, action: "resolve" }), signal: controller.signal,
        }, 12000,
      );
      if (controller.signal.aborted) return;
      if (!response.ok || body?.ok !== true || body.reference !== reference ||
        typeof body.resolvedAt !== "string" || !Number.isFinite(Date.parse(body.resolvedAt))) {
        throw Error(body?.error || "확인 결과가 저장됐는지 조회해 주세요.");
      }
      const resolvedAt = body.resolvedAt;
      setItems(previous => applied?.state === "open" && !applied.reference
        ? previous.filter(row => row.reference !== reference)
        : previous.map(row => row.reference === reference ? { ...row, resolvedAt } : row));
      setInfo("확인 완료로 표시했어요. 결제나 교환권은 변경되지 않았어요.");
    } catch (e) {
      if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "지원 요청을 처리하지 못했어요.");
    } finally {
      if (pending.current === controller) pending.current = null;
      if (!controller.signal.aborted) setBusy(false);
    }
  }

  return <details className="mb-3 rounded-xl border border-neutral-200 bg-white p-3 text-xs text-neutral-700"
    onToggle={event => { if (event.target === event.currentTarget && event.currentTarget.open && !applied) void load(initialFilter); }}>
    <summary className="min-h-11 cursor-pointer content-center font-semibold">교환권 사용이 막힌 문의</summary>
    <p className="mb-3 leading-5">회원이 직접 접수한 건이에요. 문의 번호나 매칭 ID로 주문을 확인해 주세요. 여기서 ‘확인 완료’를 눌러도 결제·번호 공개·교환권 상태는 바뀌지 않아요.</p>
    <form className="mb-3 flex flex-wrap items-end gap-2" onSubmit={event => { event.preventDefault(); void load(filter); }}>
      <label className="grid gap-1">처리 상태
        <select className={control} value={filter.state} disabled={busy || !!filter.reference.trim()}
          onChange={event => setFilter(previous => ({ ...previous, state: event.target.value as Filter["state"] }))}>
          <option value="open">확인 전</option><option value="resolved">확인 완료</option><option value="all">전체</option>
        </select>
      </label>
      <label className="grid gap-1">접수 사유
        <select className={control} value={filter.reason} disabled={busy || !!filter.reference.trim()}
          onChange={event => setFilter(previous => ({ ...previous, reason: event.target.value as Filter["reason"] }))}>
          <option value="">전체</option>{Object.entries(reasons).map(([key, label]) => <option value={key} key={key}>{label}</option>)}
        </select>
      </label>
      <label className="grid min-w-0 gap-1">문의 번호
        <input className={control} maxLength={36} value={filter.reference} disabled={busy}
          onChange={event => setFilter(previous => ({ ...previous, reference: event.target.value }))} />
      </label>
      <button type="submit" className={control} disabled={busy}>조회</button>
    </form>
    {busy ? <p role="status">불러오는 중…</p> : null}
    {error ? <p role="alert" className="text-rose-700">{error}</p> : null}
    {info ? <p role="status" className="text-emerald-700">{info}</p> : null}
    {applied && !items.length && !busy && !error ? <p>해당하는 문의가 없어요.</p> : null}
    {items.length ? <ul className="space-y-2">{items.map(row => <li key={row.reference} className="space-y-1 rounded-lg border border-neutral-200 p-3">
      <p className="font-semibold text-neutral-900">{reasons[row.reason]} · {row.resolvedAt ? "확인 완료" : "확인 전"}</p>
      <p>접수 {dateTime.format(new Date(row.createdAt))}{row.resolvedAt ? ` · 확인 ${dateTime.format(new Date(row.resolvedAt))}` : ""}</p>
      <p className="break-all">문의 {row.reference}</p><p className="break-all">회원 {row.memberId}</p><p className="break-all">매칭 {row.matchId}</p>
      <div className="flex flex-wrap gap-2">
        {applied?.reference.trim() !== row.reference ? <button type="button" className={control} disabled={busy}
          onClick={() => { const exact = { ...initialFilter, reference: row.reference }; setFilter(exact); void load(exact); }}>이 문의 주문 보기</button> : null}
        {!row.resolvedAt ? <button type="button" className={control} disabled={busy} onClick={() => void resolve(row.reference)}>확인 완료로 표시</button> : null}
      </div>
    </li>)}</ul> : null}
    {applied?.reference.trim() && items.length === 1 && orders !== null ? <section aria-label="관련 1:1 주문" className="mt-3 space-y-2">
      <p className="font-semibold text-neutral-900">관련 1:1 주문 · 최근 {orders.length}건</p>
      {orders.length ? <ul className="space-y-2">{orders.map((order, index) => <li key={order.orderNumber ?? `${order.createdAt}:${index}`} className="rounded-lg bg-neutral-50 p-3">
        <p className="break-all font-medium">{order.orderNumber ?? "주문번호 확인 불가"} · {Object.hasOwn(orderStatus, order.status) ? orderStatus[order.status] : "기타 상태"}</p>
        <p>생성 {dateTime.format(new Date(order.createdAt))}{order.approvedAt ? ` · 승인 ${dateTime.format(new Date(order.approvedAt))}` : ""}</p>
      </li>)}</ul> : <p>이 매칭에 연결된 주문이 없어요.</p>}
    </section> : null}
    {next && applied ? <button type="button" className={`${control} mt-2`} disabled={busy} onClick={() => void load(applied, next)}>이전 문의 더 보기</button> : null}
  </details>;
}
