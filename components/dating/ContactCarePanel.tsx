"use client";

import { useEffect, useRef, useState } from "react";
import { fetchClientJson } from "@/lib/client-json-request";
import type { ContactCareStatus } from "@/lib/contact-care";
import { oneOnOneMatchHref } from "@/lib/dating-1on1-match-navigation";

const inputClass = "mt-1 w-full min-w-0 rounded-lg border border-neutral-300 bg-white p-2 text-sm text-neutral-900";
const buttonClass = "min-h-[44px] rounded-lg border border-neutral-300 bg-white px-3 text-xs font-semibold text-neutral-800 disabled:opacity-50";

export default function ContactCarePanel({ matchId, guideOnly = false }: { matchId?: string; guideOnly?: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const [data, setData] = useState<ContactCareStatus | null>(null);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [busy, setBusy] = useState(false);
  const [stale, setStale] = useState(false);
  const [payment, setPayment] = useState("");
  const [first, setFirst] = useState("");
  const [explanation, setExplanation] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [reason, setReason] = useState("no_response");
  const [files, setFiles] = useState<File[]>([]);
  const [target, setTarget] = useState("");
  const pending = useRef(false);
  const alive = useRef(true);
  const controller = useRef<AbortController | null>(null);
  const details = useRef<HTMLDetailsElement | null>(null);
  useEffect(() => { alive.current = true; return () => { alive.current = false; controller.current?.abort(); }; }, []);
  useEffect(() => {
    if (matchId) return;
    const reveal = () => {
      if (window.location.hash === "#contact-care" && details.current) {
        details.current.open = true;
        details.current.scrollIntoView({ block: "center" });
      }
    };
    reveal(); window.addEventListener("hashchange", reveal);
    return () => window.removeEventListener("hashchange", reveal);
  }, [matchId]);

  const load = async () => {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError("");
    controller.current = new AbortController();
    try {
      const { response, body } = await fetchClientJson<ContactCareStatus & { error?: string }>("/api/dating/1on1/contact-care", { cache: "no-store", signal: controller.current.signal }, 12000);
      if (!response.ok || !body || !Array.isArray(body.payments) || !Array.isArray(body.matches)) throw Error(body?.error || "교환권 내역을 확인하지 못했어요.");
      if (alive.current) { setData(body); setStale(false); setPayment(body.payments.find(p => p.id === matchId || p.id === body.claim?.match_id)?.order_id ?? ""); setTarget(""); }
    } catch (e) { if (alive.current) { setStale(true); setError(e instanceof Error && e.name !== "AbortError" ? e.message : "조회가 지연돼요. 다시 확인해 주세요."); } }
    finally { pending.current = false; if (alive.current) setBusy(false); }
  };
  const send = async (action: "apply" | "redeem") => {
    if (pending.current || stale || !data) return;
    const selected = data.payments.find(p => p.order_id === payment);
    if (action === "apply" && (!selected || !first || !confirmed || !files.length || explanation.trim().length < 10)) return;
    if (action === "redeem" && (!target || !window.confirm("교환권 1장으로 이 상대와 서로의 연락처를 공개할까요? 결제는 진행되지 않습니다."))) return;
    pending.current = true; setBusy(true); setError(""); setInfo("");
    let refresh = false;
    controller.current = new AbortController();
    try {
      const payload = action === "apply" ? { action, matchId: selected!.id, orderId: payment, firstContactAt: new Date(first).toISOString(), explanation, reason, revision: data.claim?.id ?? null, confirmed }
        : { action, matchId: target, confirmed: true };
      const form = new FormData();
      if (action === "apply") { form.set("payload", JSON.stringify(payload)); files.forEach(file => form.append("evidence", file)); }
      const { response, body } = await fetchClientJson<{ ok?: boolean; error?: string }>("/api/dating/1on1/contact-care", {
        method: "POST", headers: action === "redeem" ? { "Content-Type": "application/json" } : undefined,
        body: action === "apply" ? form : JSON.stringify(payload), signal: controller.current.signal,
      }, action === "apply" ? 45000 : 15000);
      if (!response.ok || !body?.ok) throw Error(body?.error || "처리 결과를 확인하지 못했어요. 내역을 다시 조회해 주세요.");
      if (alive.current) {
        setInfo(action === "apply" ? "캡처와 함께 접수했어요. 관리자 확인 후 이곳에 결과가 표시돼요." : "교환권으로 번호 교환을 완료했어요. 아래 ‘연락처 확인’에서 확인해 주세요.");
        if (action === "apply") { setFiles([]); setConfirmed(false); }
        setStale(true);
        refresh = true;
      }
    } catch (e) { if (alive.current) { setStale(true); setError(e instanceof Error && e.name !== "AbortError" ? e.message : "응답이 늦어 결과 확인이 필요해요. 내역을 다시 조회해 주세요."); } }
    finally { pending.current = false; if (alive.current) setBusy(false); }
    // Reconcile ambiguous responses without retrying a mutation.
    if (alive.current && refresh) void load();
  };
  const claim = !matchId || data?.claim?.match_id === matchId ? data?.claim : null;
  const payments = data?.payments.filter(p => !matchId || p.id === matchId) ?? [];
  const selected = payments.find(p => p.order_id === payment);
  const date = (value: string) => new Date(value).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" });
  const canApply = !guideOnly && data && ((data.active && !data.claim) || claim?.status === "rejected" && data.active || claim?.status === "needs_info");
  return <details ref={details} id={matchId ? undefined : "contact-care"} className="mb-3 rounded-xl border border-neutral-200 bg-white px-3 text-xs text-neutral-600"
    onToggle={e => { setExpanded(e.currentTarget.open); if (e.currentTarget.open && !pending.current) void load(); }}>
    <summary className="min-h-[44px] cursor-pointer content-center font-medium text-neutral-700">{guideOnly ? "연락처 교환 지원 기준" : matchId ? "연락이 닿지 않거나 문제가 있나요? · 지원 신청" : "연락처 교환 지원 · 신청 내역 / 교환권"}</summary>
    {expanded ? <div className="space-y-3 pb-3">
      {data?.active || claim ? <p>번호교환 후 72시간 이내, 결제한 회원이 신청할 수 있어요. 캡처를 검토해 승인하면 다음 번호교환에 쓸 교환권 1장을 드려요. 계정당 1회이며 사용 전까지 유지돼요.</p> : <p>연락처 교환 지원 가능 여부와 교환권 내역을 확인할 수 있어요.</p>}
      <p className="text-[11px] leading-5">교환 직후 무응답·잠수는 첫 연락 후 24시간 이상 응답이 없을 때, 스캠·사칭 의심은 즉시 신청할 수 있어요. 단순 거절·대화 불만·대화가 이어진 뒤 관계 중단은 제외해요. 신청만으로 자동 지급되거나 상대가 제재되지는 않아요.</p>
      <p className="text-[11px] leading-5">시범 운영 시작 후 웹에서 결제한 건만 여기서 신청할 수 있어요. 앱 내 결제·별도 입금 또는 목록에 없는 건은 고객센터로 문의해 주세요.</p>
      {data && !data.active ? <p>현재 신규 신청을 받지 않아요. 이미 지급된 교환권과 신청 내역은 유지돼요.</p> : null}
      {guideOnly && data?.active ? <p>교환 완료 후 마이페이지의 해당 상대 카드에서 신청하세요. 취소·환불·무료 교환은 대상이 아니며, 스캠 의심은 별도 조사·환불 검토가 필요할 수 있어요.</p> : null}
      {!guideOnly && matchId && data?.claim && !claim ? <p>다른 매칭에 신청 또는 지급 내역이 있어요. 상단 ‘연락처 교환 지원 · 신청 내역 / 교환권’에서 확인해 주세요.</p> : null}
      {busy ? <p role="status">확인 중...</p> : null}
      {error ? <p role="alert" className="text-red-700">{error}</p> : null}
      {info ? <p role="status" className="text-emerald-700">{info}</p> : null}
      <button type="button" className={buttonClass} disabled={busy} onClick={() => void load()}>내역 다시 확인</button>
      {claim && !guideOnly ? <div className="space-y-2 rounded-lg bg-neutral-50 p-3">
        <p className="font-semibold text-neutral-900">{claim.status === "pending" ? "신청 검토 중" : claim.status === "needs_info" ? "추가 자료가 필요해요" : claim.status === "rejected" ? "신청 결과 · 반려" : claim.used_at ? "교환권 사용 완료" : "교환권 1장 · 사용 전까지 유지"}</p>
        <p className="break-all text-[11px]">신청 ID {claim.id}</p>
        {claim.review_note ? <p className="whitespace-pre-wrap break-words">{claim.review_note}</p> : null}
        {claim.supplement_due_at ? <p>추가 자료 제출: {date(claim.supplement_due_at)}까지 · 최초 신청은 유지돼요.</p> : null}
        <div className="flex flex-wrap gap-3">{Array.from({ length: claim.evidence_count }, (_, i) => <a key={i} className="inline-flex min-h-[44px] items-center underline" target="_blank" rel="noreferrer" href={`/api/dating/1on1/contact-care/evidence?claimId=${claim.id}&index=${i}`}>제출한 캡처 {i + 1}</a>)}</div>
        {claim.status === "approved" && !claim.used_at ? <>
          <label className="block">교환할 상대<select aria-label="교환할 상대" className={inputClass} value={target} onChange={e => setTarget(e.target.value)} disabled={busy || stale}>
            <option value="">쌍방 수락한 상대 선택</option>{data!.matches.map(m => <option key={m.id} value={m.id}>{m.name} · {m.id.slice(0, 8)}</option>)}
          </select></label>
          {!data!.matches.length ? <p>지금 교환 가능한 쌍방 수락 매칭이 없어요. 교환권은 그대로 남아요.</p> : null}
          <button type="button" className={buttonClass} disabled={busy || stale || !target} onClick={() => void send("redeem")}>이 매칭에 교환권 사용</button>
        </> : null}
        {claim.used_at ? <a className="inline-flex min-h-[44px] items-center underline" href={oneOnOneMatchHref(claim.used_match_id)}>연락처 확인</a> : null}
      </div> : null}
      {canApply ? <form className="space-y-3" onSubmit={e => { e.preventDefault(); void send("apply"); }}>
        {claim?.status === "rejected" ? <p>최초 신청 기한 안이라면 부족한 내용을 보완해 다시 신청할 수 있어요.</p> : null}
        <label className="block">내가 결제한 상대<select className={inputClass} value={payment} onChange={e => setPayment(e.target.value)} required disabled={busy || stale}>
          <option value="">결제 건 선택</option>{payments.map(p => <option key={p.order_id} value={p.order_id}>{p.name} · {new Date(p.exchanged_at!).toLocaleDateString("ko-KR")}</option>)}
        </select></label>
        {!payments.length ? <p>신청 가능한 웹 결제 내역이 없어요. 결제자 본인·시행 이후 결제·번호교환 후 72시간 조건을 확인해 주세요.</p> : null}
        {selected && claim?.status !== "needs_info" ? <p>신청 가능: {date(new Date(Date.parse(selected.exchanged_at!) + 72 * 3600000).toISOString())}까지</p> : null}
        <label className="block">신청 사유<select className={inputClass} value={reason} disabled={busy || stale} onChange={e => setReason(e.target.value)}><option value="no_response">교환 직후 무응답·잠수</option><option value="scam">스캠·사칭 의심</option></select></label>
        <label className="block">첫 연락을 보낸 시각<input type="datetime-local" className={inputClass} value={first} onChange={e => setFirst(e.target.value)} required disabled={busy || stale} /></label>
        <label className="block">연락 방법과 상황<textarea className={inputClass} minLength={10} maxLength={500} rows={3} value={explanation} onChange={e => setExplanation(e.target.value)} required disabled={busy || stale} placeholder="예: 카카오톡으로 먼저 인사했지만 아직 답장이 없습니다. 전화번호 등 개인정보는 적지 마세요." /></label>
        <label className="block">대화 캡처 (1~3장 · 합계 3MB 이하)<input className="mt-2 block w-full min-w-0 text-xs" type="file" accept="image/jpeg,image/png,image/webp" multiple disabled={busy || stale} onChange={e => {
          const chosen = Array.from(e.target.files ?? []);
          if (chosen.length > 3 || chosen.reduce((sum, f) => sum + f.size, 0) > 3_000_000 || chosen.some(f => !["image/jpeg", "image/png", "image/webp"].includes(f.type))) {
            setFiles([]); e.target.value = ""; setError("JPG·PNG·WebP 캡처 1~3장, 합계 3MB 이하로 선택해 주세요."); return;
          }
          setFiles(chosen); setError("");
        }} /></label>
        {files.length ? <p>{files.length}장 선택됨 · {files.map(f => f.name).join(", ")}</p> : null}
        <p className="text-[11px] leading-5">상대 식별에 필요한 부분과 연락 날짜·시간을 남기고, 전체 전화번호·사진·무관한 대화는 가려 주세요. 캡처는 본인과 관리자만 열람하며 상대에게 공개하지 않아요.</p>
        <label className="flex min-h-[44px] items-start gap-2"><input type="checkbox" className="mt-1" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} disabled={busy || stale} required /><span>제출 내용은 사실이며 필요한 부분만 첨부했어요. 관리자가 캡처를 확인한 뒤 지급 여부를 결정하는 점을 확인했어요.</span></label>
        <button className={buttonClass} disabled={busy || stale || !selected || !files.length || !confirmed || !first || explanation.trim().length < 10}>{claim?.status === "needs_info" ? "추가 자료 제출" : "교환권 신청"}</button>
      </form> : null}
      <p className="text-[11px] leading-5">결과는 이곳에서 확인해 주세요. 캡처는 검토 종료 후 30일까지만 열람할 수 있어요. 잘못된 번호·사이트 오류·환불 문의는 고객센터에서 별도로 확인해요.</p>
      <a href="https://open.kakao.com/o/s2gvTdhi" target="_blank" rel="noreferrer" className="inline-flex min-h-[44px] items-center underline">고객센터 문의</a>
    </div> : null}
  </details>;
}
