"use client";
import { useEffect, useRef, useState } from "react";
import { fetchClientJson } from "@/lib/client-json-request";
import type { ContactCareClaim } from "@/lib/contact-care";

type Item = ContactCareClaim & { nickname: string; counterparty_name?: string; exchanged_at?: string | null };
type Decision = "approved" | "rejected" | "needs_info";
const button = "min-h-[44px] rounded-lg border border-neutral-300 px-3 text-xs font-medium disabled:opacity-50";

export default function AdminContactCarePanel({ userId }: { userId?: string }) {
  return <Panel key={userId || "queue"} userId={userId} />;
}
function Panel({ userId }: { userId?: string }) {
  const [items, setItems] = useState<Item[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [stale, setStale] = useState(false);
  const pending = useRef(false), alive = useRef(true);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => { alive.current = true; return () => { alive.current = false; controller.current?.abort(); }; }, []);
  const load = async (append = false) => {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError(""); controller.current = new AbortController();
    try {
      const query = new URLSearchParams();
      if (userId) query.set("userId", userId);
      if (append && next) query.set("before", next);
      const { response, body } = await fetchClientJson<{ items: Item[]; next: string | null; error?: string }>(`/api/admin/contact-care?${query}`, { cache: "no-store", signal: controller.current.signal }, 12000);
      if (!response.ok || !body || !Array.isArray(body.items)) throw Error(body?.error || "신청 목록을 불러오지 못했어요.");
      if (alive.current) { setItems(old => append ? [...new Map([...old, ...body.items].map(i => [i.id, i])).values()] : body.items); setNext(body.next); setLoaded(true); setStale(false); }
    } catch (e) { if (alive.current) { setStale(true); setError(e instanceof Error ? e.message : "조회 실패"); } }
    finally { pending.current = false; if (alive.current) setBusy(false); }
  };
  const review = async (item: Item, decision: Decision, note: string, checked: boolean) => {
    if (pending.current || stale || !window.confirm(decision === "approved" ? "증빙 확인을 완료했으며 교환권 1장을 지급할까요? 계정당 한 번만 지급됩니다." : decision === "needs_info" ? "추가 자료를 요청할까요? 회원은 지금부터 72시간 동안 보완할 수 있어요." : "이 신청을 반려할까요? 사유가 회원에게 표시됩니다.")) return;
    pending.current = true; setBusy(true); setError(""); setInfo(""); controller.current = new AbortController();
    try {
      const { response, body } = await fetchClientJson<{ ok?: boolean; error?: string }>("/api/admin/contact-care", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ claimId: item.id, decision, note, evidenceChecked: checked }), signal: controller.current.signal }, 15000);
      if (!response.ok || !body?.ok) throw Error(body?.error || "처리 결과를 확인하지 못했습니다. 목록을 다시 조회하세요.");
      if (alive.current) { setItems(rows => rows.filter(r => r.id !== item.id)); setInfo(decision === "approved" ? "교환권 1장을 지급했습니다." : decision === "needs_info" ? "추가 자료를 요청했습니다. 회원 신청 내역에 표시됩니다." : "반려했습니다."); }
    } catch (e) { if (alive.current) { setStale(true); setError(e instanceof Error ? e.message : "처리 실패"); } }
    finally { pending.current = false; if (alive.current) setBusy(false); }
  };
  const cleanup = async () => {
    if (pending.current || !window.confirm("미접수 업로드(24시간 경과)와 검토 종료 후 30일 지난 캡처를 최대 20건 정리할까요? 신청·교환권·매칭 기록은 유지되며 캡처는 복구할 수 없습니다.")) return;
    pending.current = true; setBusy(true); setError("");
    controller.current = new AbortController();
    try {
      const { response, body } = await fetchClientJson<{ ok: boolean; removed: number; error?: string }>("/api/admin/contact-care", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "cleanup" }), signal: controller.current.signal }, 45000);
      if (!response.ok || !body?.ok) throw Error(body?.error || "정리 결과를 확인하지 못했어요.");
      if (alive.current) setInfo(`보관 기간이 끝난 캡처 ${body.removed}장을 정리했습니다. 신청·교환권 기록은 유지됩니다.`);
    } catch (e) { if (alive.current) setError(e instanceof Error ? e.message : "정리 실패"); }
    finally { pending.current = false; if (alive.current) setBusy(false); }
  };
  return <details className="mb-3 rounded-xl border border-neutral-200 bg-white p-3 text-xs text-neutral-700" onToggle={e => { if (e.currentTarget.open && !loaded) void load(); }}>
    <summary className="min-h-[44px] cursor-pointer content-center font-semibold">연락처 교환 지원 · {userId ? "회원 신청 내역" : "신청 검토"}</summary>
    <p className="mb-2 leading-5">번호교환 후 72시간 이내 접수 건입니다. 무응답은 첫 연락 후 24시간 이상, 스캠·사칭 의심은 즉시 접수합니다. 상대 식별·연락 시각·대화 경과를 캡처로 확인하세요. 단순 거절·대화 불만·관계 중단은 제외합니다. 스캠 의심은 별도 계정 조사·환불 검토가 필요하며 이 화면에서는 자동 제재하지 않습니다.</p>
    <button type="button" className={button} disabled={busy} onClick={() => void load()}>신청 새로고침</button>
    {busy ? <p role="status">처리 중...</p> : null}
    {error ? <p role="alert" className="mt-2 text-red-700">{error}</p> : null}
    {info ? <p role="status" className="mt-2 text-emerald-700">{info}</p> : null}
    {loaded && !items.length ? <p className="mt-3">신청 내역이 없습니다.</p> : null}
    {items.map(item => <ReviewRow key={item.id} item={item} disabled={busy || stale} review={review} />)}
    {next ? <button type="button" className={button} disabled={busy || stale} onClick={() => void load(true)}>다음 20건</button> : null}
    {!userId ? <details className="mt-3"><summary className="min-h-[44px] cursor-pointer content-center">캡처 보관 관리</summary><p className="mb-2">검토 중인 캡처는 제외합니다. 미접수 업로드는 24시간 후, 종료된 신청의 캡처는 종료 후 30일이 지나면 정리할 수 있습니다. 이 버튼으로 보관 기간이 지난 파일을 삭제하세요.</p><button type="button" className={button} disabled={busy} onClick={() => void cleanup()}>보관 기간 지난 캡처 정리</button></details> : null}
  </details>;
}
function ReviewRow({ item, disabled, review }: { item: Item; disabled: boolean; review: (item: Item, decision: Decision, note: string, checked: boolean) => void }) {
  const [note, setNote] = useState("");
  const [checked, setChecked] = useState(false);
  return <div className="my-3 space-y-2 rounded-lg border border-neutral-200 p-3">
    <p className="font-semibold">{item.nickname} · {item.status === "pending" ? "검토 대기" : item.status === "needs_info" ? "추가 자료 대기" : item.status === "rejected" ? "반려" : item.used_at ? "사용 완료" : "지급 완료"}</p>
    <p>{item.reason === "scam" ? "스캠·사칭 의심" : "교환 직후 무응답·잠수"} · 접수 {new Date(item.created_at).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })}</p>
    <p className="break-all">신청 {item.id}</p><p className="break-all">매칭 {item.match_id}</p>
    <p>상대: {item.counterparty_name || "상대 프로필"}{item.exchanged_at ? ` · 번호교환 ${new Date(item.exchanged_at).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })}` : ""}</p>
    <p>첫 연락 {new Date(item.first_contact_at).toLocaleString("ko-KR")}</p>
    <p className="whitespace-pre-wrap break-words">{item.explanation}</p>
    {item.review_note ? <p>{item.review_note}</p> : null}
    {item.supplement_due_at ? <p>보완 기한 {new Date(item.supplement_due_at).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })}</p> : null}
    <div className="grid grid-cols-2 gap-2">{Array.from({ length: item.evidence_count }, (_, i) => <Evidence key={i} claimId={item.id} index={i} />)}</div>
    {item.status === "pending" || item.status === "needs_info" ? <>
      <label className="flex min-h-[44px] items-center gap-2"><input type="checkbox" checked={checked} onChange={e => setChecked(e.target.checked)} disabled={disabled} />상대 식별·연락 시각·신청 사유에 맞는 캡처를 확인했습니다.</label>
      <label className="block">회원에게 표시할 검토 사유<textarea className="mt-1 w-full rounded-lg border border-neutral-300 p-2" value={note} onChange={e => setNote(e.target.value)} minLength={5} maxLength={300} disabled={disabled} rows={2} /></label>
      <div className="flex flex-wrap gap-2"><button className={button} type="button" disabled={disabled || !checked || note.trim().length < 5} onClick={() => review(item, "approved", note, checked)}>승인 · 교환권 1장</button>
        <button className={button} type="button" disabled={disabled || item.status === "needs_info" || note.trim().length < 5} onClick={() => review(item, "needs_info", note, checked)}>추가 자료 요청</button>
        <button className={button} type="button" disabled={disabled || note.trim().length < 5} onClick={() => review(item, "rejected", note, checked)}>반려</button></div>
    </> : null}
  </div>;
}

function Evidence({ claimId, index }: { claimId: string; index: number }) {
  const [failed, setFailed] = useState(false);
  const url = `/api/dating/1on1/contact-care/evidence?claimId=${claimId}&index=${index}`;
  return <a className="block rounded-lg border border-neutral-200 p-2 underline" href={url} target="_blank" rel="noreferrer">
    {/* Authenticated endpoint: never send private evidence to the public image optimizer. */}
    {/* eslint-disable-next-line @next/next/no-img-element */}
    {!failed ? <img src={url} alt={`대화 캡처 ${index + 1}`} loading="lazy" className="h-32 w-full object-contain" onError={() => setFailed(true)} /> : <p>캡처를 불러오지 못했어요. 눌러 다시 확인하세요.</p>}
    캡처 {index + 1} 크게 보기
  </a>;
}
