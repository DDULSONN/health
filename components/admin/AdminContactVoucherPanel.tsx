"use client";
import { useEffect, useRef, useState } from "react";
import { fetchClientJson } from "@/lib/client-json-request";
import { CONTACT_VOUCHER_GRANT_LIMIT, isContactVoucherAdminSnapshot, parseContactVoucherGrant,
  type ContactVoucherAdminSnapshot, type ContactVoucherGrantInput } from "@/lib/contact-care-grants";

const button = "min-h-[44px] rounded-lg border border-neutral-300 px-3 text-xs font-medium disabled:opacity-50";
const endpoint = "/api/admin/contact-care/vouchers";
function message(error: unknown, fallback: string) {
  if (error instanceof Error && !/failed to fetch|network|abort|load failed/i.test(error.message)) return error.message;
  return fallback;
}
export default function AdminContactVoucherPanel({ userId }: { userId: string }) {
  return <Panel key={userId} userId={userId} />;
}
function Panel({ userId }: { userId: string }) {
  const [data, setData] = useState<ContactVoucherAdminSnapshot | null>(null);
  const [quantity, setQuantity] = useState(1), [reason, setReason] = useState("");
  const [intent, setIntent] = useState<ContactVoucherGrantInput | null>(null);
  const [attempted, setAttempted] = useState(false), [completed, setCompleted] = useState(false);
  const [busy, setBusy] = useState(false), [stale, setStale] = useState(true);
  const [error, setError] = useState(""), [info, setInfo] = useState("");
  const alive = useRef(true), pending = useRef(false), restored = useRef(false);
  const controller = useRef<AbortController | null>(null);
  const storageKey = `gymtools:admin-contact-voucher:${userId}`;
  useEffect(() => {
    alive.current = true;
    try {
      const raw = sessionStorage.getItem(storageKey);
      if (raw) {
        const saved = parseContactVoucherGrant(JSON.parse(raw));
        if (!saved || saved.userId !== userId) throw Error("INVALID_SAVED_REQUEST");
        setIntent(saved); setAttempted(true);
        setInfo("이전에 보낸 지급 요청이 있어요. 같은 요청으로 결과를 확인해 주세요.");
      }
    } catch { setError("이전 지급 요청을 읽지 못했어요. 다른 창에서 지급 이력을 확인한 뒤 진행해 주세요."); }
    restored.current = true;
    return () => { alive.current = false; controller.current?.abort(); };
  }, [storageKey, userId]);
  const readSnapshot = async () => {
    const { response, body } = await fetchClientJson<ContactVoucherAdminSnapshot & { error?: string }>(
      `${endpoint}?userId=${encodeURIComponent(userId)}`, { cache: "no-store", signal: controller.current?.signal }, 12000);
    if (!response.ok || !isContactVoucherAdminSnapshot(body, userId)) throw Error(body?.error || "교환권 내역을 불러오지 못했어요.");
    if (alive.current) { setData(body); setStale(false); }
  };
  const load = async () => {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError(""); controller.current = new AbortController();
    try { await readSnapshot(); }
    catch (e) { if (alive.current) { setStale(true); setError(message(e, "연결이 지연됐어요. 내역을 다시 확인해 주세요.")); } }
    finally { pending.current = false; if (alive.current) setBusy(false); }
  };
  const prepare = () => {
    if (!data || !data.installed || !data.member.canGrant || stale || pending.current || !restored.current) return;
    try {
      // An uncertain request must be recovered, not replaced with a fresh ID.
      if (sessionStorage.getItem(storageKey)) throw Error("이전 지급 요청이 남아 있어요. 화면을 새로고침해 결과부터 확인해 주세요.");
      const next = parseContactVoucherGrant({ requestId: crypto.randomUUID(), userId, expectedNickname: data.member.nickname,
        quantity, reason, confirmed: true });
      if (!next) throw Error("수량과 지급 사유를 확인해 주세요.");
      setIntent(next); setAttempted(false); setError(""); setInfo("");
    } catch (e) { setError(e instanceof Error ? e.message : "지급 확인을 준비하지 못했어요."); }
  };
  const grant = async () => {
    if (!intent || pending.current || !data?.installed || stale) return;
    const request = intent;
    // Persist before the mutation, so reload/network loss can retry the same request.
    try { sessionStorage.setItem(storageKey, JSON.stringify(request)); }
    catch { setError("브라우저에 지급 요청을 보관할 수 없어 중단했어요. 저장소 설정을 확인해 주세요. 지급 요청은 보내지 않았어요."); return; }
    pending.current = true; setBusy(true); setAttempted(true); setError(""); controller.current = new AbortController();
    try {
      const { response, body } = await fetchClientJson<{ ok?: boolean; requestId?: string; quantity?: number; alreadyGranted?: boolean; remaining?: number; error?: string; resetRequest?: boolean }>(
        endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(request), signal: controller.current.signal }, 15000);
      // Only this transactional rejection proves there was no earlier issuance.
      if (response.status === 409 && body?.resetRequest === true) {
        sessionStorage.removeItem(storageKey);
        if (alive.current) { setIntent(null); setAttempted(false); setStale(true); }
        throw Error(body.error || "회원 상태가 바뀌어 지급하지 않았어요. 내역을 다시 확인해 주세요.");
      }
      if (!response.ok || body?.ok !== true || body.requestId !== request.requestId || body.quantity !== request.quantity ||
        typeof body.alreadyGranted !== "boolean" || !Number.isSafeInteger(body.remaining) || body.remaining! < 0)
        throw Error(body?.error || "지급 결과를 확인하지 못했어요. 같은 요청으로 다시 확인해 주세요.");
      try { sessionStorage.removeItem(storageKey); } catch { /* Replaying the retained ID is safe. */ }
      if (alive.current) {
        setIntent(null); setCompleted(true); setAttempted(false);
        setInfo(body.alreadyGranted ? `이미 완료된 ${body.quantity}장 지급을 확인했어요. 추가 지급하지 않았어요.` : `${request.expectedNickname}님께 교환권 ${body.quantity}장을 지급했어요.`);
        try { await readSnapshot(); }
        catch { if (alive.current) { setStale(true); setError("지급은 완료됐지만 최신 내역을 불러오지 못했어요. 내역만 다시 확인해 주세요."); } }
      }
    } catch (e) { if (alive.current) setError(message(e, "연결이 지연돼 지급 결과를 확인하지 못했어요. 같은 요청으로 다시 확인해 주세요.")); }
    finally { pending.current = false; if (alive.current) setBusy(false); }
  };
  const eligible = !!data?.installed && data.member.canGrant && !stale && !busy;
  return <details className="mb-3 rounded-xl border border-neutral-200 bg-white p-3 text-xs text-neutral-700"
    onToggle={e => { if (e.currentTarget.open && !data) void load(); }}>
    <summary className="min-h-[44px] cursor-pointer content-center font-semibold">1:1 교환권 · 지급 / 내역{data ? ` · 보유 ${data.remaining}장` : ""}</summary>
    <p className="mb-2 leading-5">쌍방 수락한 상대와 번호를 교환할 때 쓰는 교환권이에요. 사용 전까지 유지되며 오픈카드 지원권과 달라요.</p>
    <button type="button" className={button} disabled={busy} onClick={() => void load()}>내역 다시 확인</button>
    {busy ? <p role="status" className="mt-2">처리 중…</p> : null}
    {error ? <p role="alert" className="mt-2 break-words text-red-700">{error}</p> : null}
    {info ? <p role="status" className="mt-2 break-words text-emerald-700">{info}</p> : null}
    {data ? <>
      <p className="mt-3 font-semibold">{data.member.nickname} · 보유 {data.remaining}장</p>
      <p className="mt-1 text-neutral-500">추가 지급 {data.manualRemaining}장 · 증빙 승인 {data.claimRemaining}장</p>
      {!data.installed ? <p className="mt-2 text-amber-800">관리자 지급 SQL 적용 후 사용할 수 있어요.</p> : !data.member.canGrant ? <p className="mt-2 text-amber-800">탈퇴·이용 제한·미인증 회원에게는 새로 지급할 수 없어요.</p> : null}
      {intent ? <div className="mt-3 space-y-2 rounded-lg border border-rose-200 bg-rose-50/30 p-3">
        <p className="font-semibold">{intent.expectedNickname}님께 {intent.quantity}장 지급</p>
        <p className="break-all text-neutral-500">회원 ID {userId}</p><p className="whitespace-pre-wrap break-words">사유: {intent.reason}</p>
        <p>교환권만 추가하며, 번호를 공개하거나 결제를 진행하지 않아요.</p>
        {attempted ? <p>결과가 불명확해도 같은 요청으로 확인해 중복 지급을 막아요.</p> : null}
        <div className="flex flex-wrap gap-2">
          <button type="button" className={`${button} border-black bg-black text-white`} disabled={busy || stale || !data.installed || (!attempted && !data.member.canGrant)} onClick={() => void grant()}>{attempted ? "같은 요청으로 지급 확인" : "확인하고 지급"}</button>
          {!attempted ? <button type="button" className={button} disabled={busy} onClick={() => setIntent(null)}>취소</button> : null}
        </div>
      </div> : completed ? <button type="button" className={`${button} mt-3`} disabled={!eligible} onClick={() => { setCompleted(false); setQuantity(1); setReason(""); setInfo(""); }}>새 지급 준비</button> :
        <form className="mt-3 space-y-2" onSubmit={e => { e.preventDefault(); prepare(); }}>
          <label className="block">지급 수량<select aria-label="1:1 교환권 지급 수량" className="ml-2 min-h-[44px] rounded-lg border border-neutral-300 px-3" value={quantity} disabled={!eligible} onChange={e => setQuantity(Number(e.target.value))}>
            {Array.from({ length: CONTACT_VOUCHER_GRANT_LIMIT }, (_, i) => <option key={i + 1} value={i + 1}>{i + 1}장</option>)}
          </select></label>
          <label className="block">지급 사유<textarea aria-label="1:1 교환권 지급 사유" className="mt-1 w-full rounded-lg border border-neutral-300 p-2" rows={2} minLength={5} maxLength={300} value={reason} disabled={!eligible} onChange={e => setReason(e.target.value)} placeholder="예: 고객 문의 확인 후 추가 지급" /></label>
          <button type="submit" className={button} disabled={!eligible || reason.trim().length < 5}>지급 내용 확인</button>
        </form>}
      <details className="mt-3"><summary className="min-h-[44px] cursor-pointer content-center">최근 추가 지급 내역 · 최대 20장</summary>
        {!data.history.length ? <p>추가 지급 내역이 없어요.</p> : <ul className="space-y-2">{data.history.map(row => <li key={row.id} className="rounded-lg bg-neutral-50 p-2">
          <p>{new Date(row.created_at).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })} · 1장 · {row.used_at ? "사용 완료" : row.revoked_at ? "회수" : "미사용"}</p>
          <p className="whitespace-pre-wrap break-words text-neutral-500">{row.reason}</p>
        </li>)}</ul>}
      </details>
    </> : null}
  </details>;
}
