"use client";

import { useEffect, useId, useRef, useState } from "react";
import { fetchClientJson } from "@/lib/client-json-request";
import { contactCareApplicationIssue, type ContactCareStatus } from "@/lib/contact-care";
import { oneOnOneMatchHref } from "@/lib/dating-1on1-match-navigation";
import { CareTransportError, careAttemptRecorded, careClientError, fetchCareJson, snapshotCareEvidence, type CareAttempt } from "@/lib/contact-care-client";

const inputClass = "mt-1 w-full min-w-0 rounded-lg border border-neutral-300 bg-white p-2 text-sm text-neutral-900";
const buttonClass = "min-h-[44px] rounded-lg border border-neutral-300 bg-white px-3 text-xs font-semibold text-neutral-800 disabled:opacity-50";

export default function ContactCarePanel({ matchId, guideOnly = false }: { matchId?: string; guideOnly?: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const [data, setData] = useState<ContactCareStatus | null>(null);
  const [summaryBalance, setSummaryBalance] = useState<number | null>(null);
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
  const [preparingFiles, setPreparingFiles] = useState(false);
  const [target, setTarget] = useState("");
  const [now, setNow] = useState(Date.now);
  const applicationHintId = useId();
  const pending = useRef(false);
  const fileSelection = useRef(0);
  const unresolved = useRef<CareAttempt | null>(null);
  const alive = useRef(true);
  const controller = useRef<AbortController | null>(null);
  const details = useRef<HTMLDetailsElement | null>(null);
  useEffect(() => { alive.current = true; return () => { alive.current = false; controller.current?.abort(); }; }, []);
  useEffect(() => {
    if (matchId || guideOnly) return;
    const summaryController = new AbortController();
    // My Page only: one small count request, no order/match listing or polling.
    void fetchClientJson<{ remaining: number }>("/api/dating/1on1/contact-care?summary=1", { cache: "no-store", signal: summaryController.signal }, 12000)
      .then(({ response, body }) => {
        if (!summaryController.signal.aborted && response.ok && body && Number.isSafeInteger(body.remaining) && body.remaining >= 0) setSummaryBalance(body.remaining);
      }).catch(() => { /* Full details retain explicit error/retry handling. */ });
    return () => summaryController.abort();
  }, [matchId, guideOnly]);
  useEffect(() => {
    if (!expanded) return;
    // Only an open panel updates its clock; no API polling or collapsed-card timers.
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [expanded]);
  useEffect(() => {
    if (matchId) return;
    const reveal = () => {
      // Login redirects retain the query string, but may discard the fragment.
      if ((window.location.hash === "#contact-care" || new URLSearchParams(window.location.search).get("care") === "1") && details.current) {
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
      const { response, body } = await fetchCareJson<ContactCareStatus & { error?: string }>({ cache: "no-store", signal: controller.current.signal }, 12000);
      if (!response.ok || !body || !Array.isArray(body.payments) || !Array.isArray(body.matches)) throw Error(body?.error || "교환권 내역을 확인하지 못했어요.");
      if (alive.current) {
        setData(body); setStale(false);
        const eligible = body.payments.filter(p => !matchId || p.id === matchId);
        setPayment(previous => eligible.some(p => p.order_id === previous) ? previous
          : eligible.find(p => p.id === matchId || p.id === body.claim?.match_id)?.order_id ?? "");
        setTarget(previous => body.matches.some(m => m.id === previous) ? previous : "");
        const attempt = unresolved.current;
        if (attempt) {
          const recorded = careAttemptRecorded(body, attempt);
          setInfo(recorded ? attempt.action === "apply" ? "신청이 접수된 것을 확인했어요. 이곳에서 결과를 확인해 주세요."
            : "교환권 사용을 확인했어요. 아래 ‘연락처 확인’에서 확인해 주세요."
            : "내역을 다시 불러왔어요. 아직 완료 내역이 확인되지 않아요. 입력 내용은 유지했으니 확인 후 다시 진행해 주세요.");
          if (recorded && attempt.action === "apply") { fileSelection.current++; setFiles([]); setConfirmed(false); }
          unresolved.current = null;
        }
      }
    } catch (e) { if (alive.current) { setStale(true); setInfo(""); setError(`${careClientError(e)} ‘내역 다시 확인’을 눌러 주세요. 작성한 내용은 유지돼요.`); } }
    finally { pending.current = false; if (alive.current) setBusy(false); }
  };
  const send = async (action: "apply" | "redeem" | "redeem_manual") => {
    if (pending.current || preparingFiles || stale || !data) return;
    const selected = data.payments.find(p => p.order_id === payment);
    if (action === "apply") {
      const issue = contactCareApplicationIssue({ selected, first, reason, explanation, evidenceCount: files.length, confirmed, stale,
        supplement: data.claim?.status === "needs_info" ? { dueAt: data.claim.supplement_due_at } : undefined, now: Date.now() });
      if (issue) { setError(issue); return; }
    }
    if (action !== "apply" && (!target || !window.confirm("교환권 1장으로 이 상대와 서로의 연락처를 공개할까요? 결제는 진행되지 않습니다."))) return;
    pending.current = true; setBusy(true); setError(""); setInfo("");
    let refresh = false;
    const attempt: CareAttempt = { action, matchId: action === "apply" ? selected!.id : target, orderId: action === "apply" ? payment : undefined };
    controller.current = new AbortController();
    try {
      const payload = action === "apply" ? { action, matchId: selected!.id, orderId: payment, firstContactAt: new Date(first).toISOString(), explanation, reason, revision: data.claim?.id ?? null, confirmed }
        : { action, matchId: target, confirmed: true };
      const form = new FormData();
      if (action === "apply") { form.set("payload", JSON.stringify(payload)); files.forEach(file => form.append("evidence", file)); }
      const { response, body } = await fetchCareJson<{ ok?: boolean; error?: string }>({
        method: "POST", headers: action !== "apply" ? { "Content-Type": "application/json" } : undefined,
        body: action === "apply" ? form : JSON.stringify(payload), signal: controller.current.signal,
      }, action === "apply" ? 45000 : 15000);
      if (response.status >= 500 || !body || (response.ok && body.ok !== true)) throw new CareTransportError("response");
      if (!response.ok) throw Error(body.error || "처리 결과를 확인하지 못했어요. 내역을 다시 조회해 주세요.");
      if (alive.current) {
        setInfo(action === "apply" ? "캡처와 함께 접수했어요. 관리자 확인 후 이곳에 결과가 표시돼요." : "교환권으로 번호 교환을 완료했어요. 아래 ‘연락처 확인’에서 확인해 주세요.");
        if (action === "apply") { fileSelection.current++; setFiles([]); setConfirmed(false); }
        setStale(true);
        refresh = true;
      }
    } catch (e) { if (alive.current) {
      setStale(true);
      if (e instanceof CareTransportError) {
        unresolved.current = attempt;
        setInfo("연결이 원활하지 않아 처리 내역을 다시 확인하고 있어요. 중복 요청은 보내지 않아요.");
        refresh = true;
      } else setError(careClientError(e));
    } }
    finally { pending.current = false; if (alive.current) setBusy(false); }
    // Reconcile ambiguous responses without retrying a mutation.
    if (alive.current && refresh) void load();
  };
  const claim = !matchId || data?.claim?.match_id === matchId ? data?.claim : null;
  const manualRemaining = data?.manual_remaining ?? 0;
  const remaining = data ? manualRemaining + (data.claim?.status === "approved" && !data.claim.used_at ? 1 : 0) : summaryBalance;
  const payments = data?.payments.filter(p => !matchId || p.id === matchId) ?? [];
  const selected = payments.find(p => p.order_id === payment);
  const date = (value: string) => new Date(value).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" });
  const canApply = !guideOnly && data && ((data.active && !data.claim) || claim?.status === "rejected" && data.active || claim?.status === "needs_info");
  const applicationIssue = contactCareApplicationIssue({ selected, first, reason, explanation, evidenceCount: files.length, confirmed, stale,
    supplement: claim?.status === "needs_info" ? { dueAt: claim.supplement_due_at } : undefined, now });
  return <details ref={details} id={matchId ? undefined : "contact-care"} className="mb-3 rounded-xl border border-neutral-200 bg-white px-3 text-xs text-neutral-600"
    onToggle={e => { setExpanded(e.currentTarget.open); if (e.currentTarget.open && !pending.current) void load(); }}>
    <summary className="min-h-[44px] cursor-pointer content-center py-2 font-medium text-neutral-700">{guideOnly ? <>
      교환 직후 연락이 끊기면? · 지원 기준
      <span className="mt-0.5 block text-[11px] font-normal leading-5 text-neutral-500">교환권 지원은 증빙 검토·승인이 필요해요.</span>
    </> : matchId ? "연락이 닿지 않거나 문제가 있나요? · 지원 신청" : <>연락처 교환 지원 · 신청 내역 / 교환권{remaining != null && remaining > 0 ? <span className="ml-2 inline-block rounded-full bg-rose-50 px-2 py-0.5 font-semibold text-rose-700">보유 {remaining}장</span> : null}</>}</summary>
    {expanded ? <div className="space-y-3 pb-3">
      {data?.active || claim ? <p>번호교환 후 72시간 이내, 결제한 회원이 신청할 수 있어요. 캡처를 검토해 승인하면 다음 번호교환에 쓸 교환권 1장을 드려요. 증빙 신청을 통한 보상은 계정당 1회이며, 교환권은 사용 전까지 유지돼요.</p> : <p>연락처 교환 지원 가능 여부와 교환권 내역을 확인할 수 있어요.</p>}
      <p className="text-[11px] leading-5">교환 직후 무응답·잠수는 첫 연락 후 24시간 이상 응답이 없을 때, 스캠·사칭 의심은 즉시 신청할 수 있어요. 단순 거절·대화 불만·대화가 이어진 뒤 관계 중단은 제외해요. 신청만으로 자동 지급되거나 상대가 제재되지는 않아요.</p>
      <p className="text-[11px] leading-5">웹에서 직접 결제한 번호교환이 대상이에요. 시행 전에 결제했어도 번호교환 후 72시간 이내라면 신청할 수 있어요. 앱 내 결제·별도 입금 또는 목록에 없는 건은 고객센터로 문의해 주세요.</p>
      {data && !data.active ? <p>현재 신규 신청을 받지 않아요. 이미 지급된 교환권과 신청 내역은 유지돼요.</p> : null}
      {guideOnly && data?.active ? <p>교환 완료 후 마이페이지의 해당 상대 카드에서 신청하세요. 취소·환불·무료 교환은 대상이 아니며, 스캠 의심은 별도 조사·환불 검토가 필요할 수 있어요.</p> : null}
      {!guideOnly && matchId && data?.claim && !claim ? <p>다른 매칭에 신청 또는 지급 내역이 있어요. 상단 ‘연락처 교환 지원 · 신청 내역 / 교환권’에서 확인해 주세요.</p> : null}
      {busy ? <p role="status">확인 중...</p> : null}
      {error ? <p role="alert" className="text-red-700">{error}</p> : null}
      {info ? <p role="status" className="text-emerald-700">{info}</p> : null}
      <button type="button" className={buttonClass} disabled={busy} onClick={() => void load()}>내역 다시 확인</button>
      {!guideOnly && !matchId && data && (manualRemaining > 0 || !!data.manual_history?.length) ? <div className="space-y-2 rounded-lg bg-neutral-50 p-3">
        <p className="font-semibold text-neutral-900">추가 지급 교환권 {manualRemaining}장 · 사용 전까지 유지</p>
        <p>쌍방 수락한 상대와 번호를 교환할 때 1장씩 사용해요. 별도 결제는 없어요.</p>
        {manualRemaining > 0 ? <>
          <label className="block">교환할 상대<select aria-label="추가 지급 교환권으로 교환할 상대" className={inputClass} value={target} onChange={e => setTarget(e.target.value)} disabled={busy || stale}>
            <option value="">쌍방 수락한 상대 선택</option>{data.matches.map(m => <option key={m.id} value={m.id}>{m.name} · {m.id.slice(0, 8)}</option>)}
          </select></label>
          {!data.matches.length ? <p>지금 교환 가능한 쌍방 수락 매칭이 없어요. 교환권은 그대로 남아요.</p> : null}
          <button type="button" className={buttonClass} disabled={busy || stale || !target} onClick={() => void send("redeem_manual")}>이 매칭에 교환권 사용</button>
        </> : null}
        {data.manual_history?.length ? <details><summary className="min-h-[44px] cursor-pointer content-center">최근 교환권 사용 내역</summary>
          <ul>{data.manual_history.map(item => <li key={item.used_match_id}><a className="inline-flex min-h-[44px] items-center underline" href={oneOnOneMatchHref(item.used_match_id)}>{date(item.used_at)} · 연락처 확인</a></li>)}</ul>
        </details> : null}
      </div> : null}
      {claim && !guideOnly ? <div className="space-y-2 rounded-lg bg-neutral-50 p-3">
        <p className="font-semibold text-neutral-900">{claim.status === "pending" ? "신청 검토 중" : claim.status === "needs_info" ? "추가 자료가 필요해요" : claim.status === "rejected" ? "신청 결과 · 반려" : claim.used_at ? "교환권 사용 완료" : "교환권 1장 · 사용 전까지 유지"}</p>
        <p className="break-all text-[11px]">신청 ID {claim.id}</p>
        {claim.review_note ? <p className="whitespace-pre-wrap break-words">{claim.review_note}</p> : null}
        {claim.supplement_due_at ? <p>추가 자료 제출: {date(claim.supplement_due_at)}까지 · 최초 신청은 유지돼요.</p> : null}
        <div className="flex flex-wrap gap-3">{Array.from({ length: claim.evidence_count }, (_, i) => <a key={i} className="inline-flex min-h-[44px] items-center underline" target="_blank" rel="noreferrer" href={`/api/dating/1on1/contact-care/evidence?claimId=${claim.id}&index=${i}`}>제출한 캡처 {i + 1}</a>)}</div>
        {claim.status === "approved" && !claim.used_at && (matchId || manualRemaining === 0) ? <>
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
        {!payments.length ? <p>신청 가능한 웹 결제 내역이 없어요. 결제자 본인인지, 번호교환 후 72시간 이내인지 확인해 주세요. 취소·환불·무료 교환은 대상이 아니에요.</p> : null}
        {selected && claim?.status !== "needs_info" ? <p>신청 가능: {date(new Date(Date.parse(selected.exchanged_at!) + 72 * 3600000).toISOString())}까지</p> : null}
        <label className="block">신청 사유<select className={inputClass} value={reason} disabled={busy || stale} onChange={e => setReason(e.target.value)}><option value="no_response">교환 직후 무응답·잠수</option><option value="scam">스캠·사칭 의심</option></select></label>
        <label className="block">첫 연락을 보낸 시각<input type="datetime-local" className={inputClass} value={first} onChange={e => setFirst(e.target.value)} required disabled={busy || stale} /></label>
        <label className="block">연락 방법과 상황<textarea className={inputClass} minLength={10} maxLength={500} rows={3} value={explanation} onChange={e => setExplanation(e.target.value)} required disabled={busy || stale} placeholder="예: 카카오톡으로 먼저 인사했지만 아직 답장이 없습니다. 전화번호 등 개인정보는 적지 마세요." /></label>
        <label className="block">대화 캡처 (1~3장 · 합계 3MB 이하)<input className="mt-2 block w-full min-w-0 text-xs" type="file" accept="image/jpeg,image/png,image/webp" multiple disabled={busy || stale} onChange={async e => {
          const input = e.currentTarget;
          const chosen = Array.from(e.target.files ?? []);
          const selection = ++fileSelection.current;
          setFiles([]); setPreparingFiles(true); setError("");
          try {
            const copies = await snapshotCareEvidence(chosen);
            if (alive.current && fileSelection.current === selection) setFiles(copies);
          } catch (error) {
            if (alive.current && fileSelection.current === selection) { input.value = ""; setError(careClientError(error)); }
          } finally {
            if (alive.current && fileSelection.current === selection) setPreparingFiles(false);
          }
        }} /></label>
        {preparingFiles ? <p role="status">첨부한 캡처를 확인하고 있어요.</p> : null}
        {files.length ? <p>{files.length}장 선택됨 · {files.map(f => f.name).join(", ")}</p> : null}
        <p className="text-[11px] leading-5">상대 식별에 필요한 부분과 연락 날짜·시간을 남기고, 전체 전화번호·사진·무관한 대화는 가려 주세요. 캡처는 본인과 관리자만 열람하며 상대에게 공개하지 않아요.</p>
        <label className="flex min-h-[44px] items-start gap-2"><input type="checkbox" className="mt-1" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} disabled={busy || stale} required /><span>제출 내용은 사실이며 필요한 부분만 첨부했어요. 관리자가 캡처를 확인한 뒤 지급 여부를 결정하는 점을 확인했어요.</span></label>
        {applicationIssue ? <p id={applicationHintId} role="status" className="text-[11px] leading-5 text-neutral-600">{applicationIssue}</p> : null}
        <button className={buttonClass} aria-describedby={applicationIssue ? applicationHintId : undefined} disabled={busy || preparingFiles || !!applicationIssue}>{claim?.status === "needs_info" ? "추가 자료 제출" : "교환권 신청"}</button>
      </form> : null}
      <p className="text-[11px] leading-5">결과는 이곳에서 확인해 주세요. 캡처는 검토 종료 후 30일까지만 열람할 수 있어요. 잘못된 번호·사이트 오류·환불 문의는 고객센터에서 별도로 확인해요.</p>
      <a href="https://open.kakao.com/o/s2gvTdhi" target="_blank" rel="noreferrer" className="inline-flex min-h-[44px] items-center underline">고객센터 문의</a>
    </div> : null}
  </details>;
}
