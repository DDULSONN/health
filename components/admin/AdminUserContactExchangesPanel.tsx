"use client";

import { useEffect, useRef, useState } from "react";
import { fetchClientJson } from "@/lib/client-json-request";
import type { AdminContactExchangeCursor, AdminContactExchangeItem, AdminContactExchangeList } from "@/lib/admin-contact-exchanges";

type Props = { userId: string; onClosed: (matchId: string) => void };

// A keyed child drops both the previous member's data and pending UI updates on member switches.
export default function AdminUserContactExchangesPanel(props: Props) {
  return <MemberContactExchanges key={props.userId} {...props} />;
}

function MemberContactExchanges({ userId, onClosed }: Props) {
  const [items, setItems] = useState<AdminContactExchangeItem[]>([]);
  const [cursor, setCursor] = useState<AdminContactExchangeCursor | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState("");
  const [confirmId, setConfirmId] = useState("");
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [needsReload, setNeedsReload] = useState(false);
  const pending = useRef(false);
  const mounted = useRef(true);
  const controller = useRef<AbortController | null>(null);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; controller.current?.abort(); };
  }, []);

  const load = async (append = false) => {
    if (pending.current || (append && (!cursor || needsReload))) return;
    pending.current = true;
    controller.current = new AbortController();
    setBusy("load"); setError(""); setConfirmId("");
    try {
      const query = new URLSearchParams();
      if (append && cursor) { query.set("before_id", cursor.id); query.set("before_created_at", cursor.created_at); }
      const { response, body } = await fetchClientJson<AdminContactExchangeList & { error?: string }>(
        `/api/admin/users/${encodeURIComponent(userId)}/contact-exchanges?${query}`,
        { cache: "no-store", signal: controller.current.signal }, 15000,
      );
      if (!response.ok || !body?.ok || !Array.isArray(body.items)) throw new Error(body?.error || "번호 교환 내역을 불러오지 못했습니다.");
      if (!mounted.current) return;
      setItems(current => append ? [...new Map([...current, ...body.items].map(item => [item.id, item])).values()] : body.items);
      setCursor(body.next_cursor); setLoaded(true); setNeedsReload(false);
    } catch (error) {
      if (mounted.current) {
        setNeedsReload(true);
        setError(error instanceof Error && error.name !== "AbortError" ? error.message : "조회 시간이 초과됐습니다. 다시 조회해 주세요.");
      }
    } finally {
      pending.current = false;
      if (mounted.current) setBusy("");
    }
  };

  const close = async (item: AdminContactExchangeItem) => {
    if (pending.current || needsReload || confirmId !== item.id) return;
    pending.current = true;
    controller.current = new AbortController();
    setBusy(item.id); setError(""); setInfo("");
    try {
      const { response, body } = await fetchClientJson<{
        ok?: boolean; match_id?: string; state?: string; contact_exchange_status?: string; error?: string;
      }>(`/api/admin/users/${encodeURIComponent(userId)}/contact-exchanges/${encodeURIComponent(item.id)}/close`,
        { method: "POST", signal: controller.current.signal }, 30000);
      if (!response.ok || !body?.ok || body.match_id !== item.id || body.state !== "admin_canceled" || body.contact_exchange_status !== "canceled") {
        throw new Error(body?.error || "처리 결과를 확인하지 못했습니다. 목록을 다시 조회해 주세요.");
      }
      if (!mounted.current) return;
      setItems(current => current.filter(row => row.id !== item.id));
      setInfo(`${item.counterpart_name || item.counterpart_nickname || "상대 회원"}님과의 번호 교환을 닫았습니다. 결제 내역은 유지됩니다.`);
      onClosed(item.id);
    } catch (error) {
      if (mounted.current) {
        setNeedsReload(true);
        setError(error instanceof Error && error.name !== "AbortError"
          ? error.message
          : "처리 결과를 확인하지 못했습니다. 자동으로 다시 요청하지 않습니다. 목록을 다시 조회해 주세요.");
      }
    } finally {
      pending.current = false;
      if (mounted.current) { setBusy(""); setConfirmId(""); }
    }
  };

  return (
    <section className="rounded-xl border border-neutral-200 bg-white p-3" aria-label="1:1 번호 교환 완료 관리">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-bold text-neutral-900">1:1 번호 교환 완료</h3>
          <p className="mt-1 text-xs text-neutral-500">번호 교환이 끝난 매칭만 10건씩 확인하고 닫을 수 있어요.</p>
        </div>
        <button type="button" disabled={Boolean(busy)} onClick={() => void load()}
          className="min-h-10 rounded-lg border border-neutral-200 px-3 py-2 text-xs font-semibold text-neutral-700 disabled:opacity-50">
          {busy === "load" ? "조회 중..." : loaded || needsReload ? "목록 다시 조회" : "번호 교환 내역 보기"}
        </button>
      </div>
      {error && <p role="alert" className="mt-2 text-xs leading-5 text-rose-700">{error}</p>}
      {info && <p role="status" className="mt-2 text-xs leading-5 text-emerald-700">{info}</p>}
      {needsReload && <p className="mt-1 text-xs text-neutral-600">‘목록 다시 조회’로 현재 상태를 확인한 후 진행해 주세요.</p>}
      {loaded && !items.length && !cursor && !needsReload && <p className="mt-3 text-xs text-neutral-500">현재 열려 있는 번호 교환 완료 내역이 없습니다.</p>}
      <div className="mt-3 space-y-2">
        {items.map(item => (
          <div key={item.id} className="rounded-lg border border-neutral-200 bg-neutral-50 p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 break-words">
                <p className="text-sm font-semibold text-neutral-900">상대: {item.counterpart_name || "프로필 정보 없음"}</p>
                <p className="mt-1 text-xs text-neutral-600">닉네임 {item.counterpart_nickname || "정보 없음"} · 내 1:1 이름 {item.own_name || "정보 없음"}</p>
                <p className="mt-1 text-xs text-neutral-500">번호 교환 {item.approved_at ? new Date(item.approved_at).toLocaleString("ko-KR") : "일시 정보 없음"}</p>
                <p className="mt-1 break-all text-[11px] text-neutral-400">매칭 ID {item.id}</p>
              </div>
              <button type="button" disabled={Boolean(busy) || needsReload} onClick={() => { setConfirmId(item.id); setInfo(""); }}
                className="min-h-10 shrink-0 rounded-lg border border-rose-200 bg-white px-3 py-2 text-xs font-semibold text-rose-700 disabled:opacity-50">닫기</button>
            </div>
            {confirmId === item.id && (
              <div className="mt-3 rounded-lg border border-rose-200 bg-white p-3">
                <p className="text-xs font-bold text-neutral-900">{item.counterpart_name || item.counterpart_nickname || "상대 회원"}님과의 번호 교환을 닫을까요?</p>
                <p className="mt-1 text-xs leading-5 text-neutral-600">양쪽의 매칭이 종료되고 연락처를 더 이상 조회할 수 없습니다. 이미 확인하거나 저장한 번호는 회수할 수 없습니다.</p>
                <p className="mt-1 text-xs leading-5 text-rose-700">결제 내역은 유지되며 자동 환불되지 않습니다. 이 화면에서 다시 열 수 없습니다.</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <button type="button" disabled={Boolean(busy)} onClick={() => setConfirmId("")}
                    className="min-h-10 rounded-lg border border-neutral-200 px-3 py-2 text-xs font-semibold disabled:opacity-50">취소</button>
                  <button type="button" disabled={Boolean(busy) || needsReload} onClick={() => void close(item)}
                    className="min-h-10 rounded-lg bg-rose-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">
                    {busy === item.id ? "닫는 중..." : "번호 공개 종료"}
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
      {cursor && !needsReload && <button type="button" disabled={Boolean(busy)} onClick={() => void load(true)}
        className="mt-3 min-h-10 w-full rounded-lg border border-neutral-200 py-2 text-xs font-semibold disabled:opacity-50">이전 내역 더 보기</button>}
    </section>
  );
}
