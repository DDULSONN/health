"use client";
import { useCallback, useEffect, useRef, useState } from "react";

type Settings = { mode: "off" | "observe" | "repair"; email_enabled: boolean };
type Result = { configured: boolean; settings?: Settings; total?: number; pending?: number; items?: {
  id: string; name: string; day: string; state: string; finding: string | null;
  pool: number; overlap: number; shown: number; widened: number; ageMismatch: number; emailState: string; checkedAt: string | null;
}[] };
const labels: Record<string, string> = { healthy: "변경 확인", quota_limit: "이용 횟수 제한", pool_small: "후보 풀 부족",
  repeat_review: "반복 검토 필요", check_failed: "점검 실패", superseded: "상태 변경 · 복구 안 함",
  repair_ready: "복구 가능", repair_review: "수동 확인 필요", repaired: "복구 완료", fit_review: "거리·나이 검토" };

export default function AdminRefreshMonitorPanel() {
  const [result, setResult] = useState<Result | null>(null);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const seq = useRef(0);
  const load = useCallback(async () => {
    const request = ++seq.current;
    setLoading(true); setError("");
    try {
      const response = await fetch(`/api/admin/dating/1on1/refresh-monitor?page=${page}`, { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw Error(body.error ?? "점검 결과를 읽지 못했습니다.");
      if (seq.current === request) setResult(body);
    } catch (e) { if (seq.current === request) setError(e instanceof Error ? e.message : "불러오기에 실패했습니다."); }
    finally { if (seq.current === request) setLoading(false); }
  }, [page]);
  const invalidate = useCallback(() => { seq.current++; }, []);
  useEffect(() => { void load(); return invalidate; }, [load, invalidate]);
  const save = async (next: Settings) => {
    if (!result?.settings || saving || loading) return;
    if (next.mode === "repair" && result.settings.mode !== "repair" && !window.confirm(
      "확인된 저장 오류만 횟수 차감 없이 복구하고, 성공한 회원에게 사이트 알림을 보냅니다. 자동 복구를 켤까요?")) return;
    if (next.email_enabled && !result.settings.email_enabled && !window.confirm(
      "이후 복구된 회원에게만 안내 메일을 보냅니다. 수신거부 회원은 제외합니다. 켤까요?")) return;
    setSaving(true); setError("");
    try {
      const response = await fetch("/api/admin/dating/1on1/refresh-monitor", { method: "PATCH",
        headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...next,
          expected_mode: result.settings.mode, expected_email_enabled: result.settings.email_enabled }) });
      const body = await response.json();
      if (!response.ok) throw Error(body.error ?? "저장에 실패했습니다.");
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "저장에 실패했습니다."); }
    finally { setSaving(false); }
  };
  const busy = loading || saving;
  return <section aria-label="1:1 새로고침 일일 점검" className="mb-3 rounded-xl border border-neutral-200 bg-white p-3 text-xs text-neutral-700">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h3 className="font-bold text-neutral-900">1:1 새로고침 일일 점검</h3>
      <button type="button" disabled={busy} onClick={() => void load()} className="rounded-lg border px-2 py-1 disabled:opacity-50">{loading ? "불러오는 중" : "결과 새로고침"}</button>
    </div>
    <p className="mt-2 leading-5 text-neutral-500">전날 이용 기록을 나눠 점검합니다. 후보 부족은 오류로 처리하지 않고, 요청·찜·매칭은 유지합니다.</p>
    {error && <p role="alert" className="mt-2 text-red-700">{error}</p>}
    {saving && <p role="status" className="mt-2 text-neutral-500">설정 저장 중…</p>}
    {result?.configured === false && <p className="mt-2">점검 SQL 설치가 필요합니다. 기존 새로고침은 그대로 사용할 수 있습니다.</p>}
    {result?.settings && <>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <label>작동 방식 <select aria-label="점검 작동 방식" disabled={busy} value={result.settings.mode}
          onChange={e => void save({ mode: e.target.value as Settings["mode"], email_enabled: false })} className="rounded-lg border bg-white p-1">
          <option value="off">점검 중지</option><option value="observe">점검만</option><option value="repair">확인된 오류 자동 복구</option>
        </select></label>
        <label className="flex items-center gap-1"><input type="checkbox" checked={result.settings.email_enabled}
          disabled={busy || result.settings.mode !== "repair"}
          onChange={e => void save({ ...result.settings!, email_enabled: e.target.checked })} />복구 안내 메일</label>
      </div>
      <p className="mt-2 text-neutral-500">점검 대기 {result.pending ?? 0}건 · 기록 {result.total ?? 0}건 · 최근 30일</p>
      <div className="mt-2 space-y-2">
        {result.items?.map(item => <div key={item.id} className="rounded-lg border border-neutral-100 p-2">
          <div className="flex flex-wrap justify-between gap-1"><span className="break-all font-semibold">{item.name}</span>
            <span>{item.state !== "done" ? "점검 대기" : labels[item.finding ?? ""] ?? "확인 필요"}</span></div>
          <p className="mt-1 text-neutral-500">{item.day} · 계산된 후보 {item.shown}명 중 이전 목록과 {item.overlap}명 겹침 · 전체 후보 {item.pool}명</p>
          {(item.widened > 0 || item.ageMismatch > 0) && <p className="mt-1 text-neutral-500">먼 지역 {item.widened}명 · 기본 추천 나이 범위 밖 {item.ageMismatch}명</p>}
          {item.emailState !== "none" && <p className="mt-1 text-neutral-500">메일: {({ pending: "대기", sending: "발송 확인 필요", sent: "발송 완료", skipped: "발송 안 함", unknown: "결과 확인 필요" } as Record<string, string>)[item.emailState]}</p>}
        </div>)}
        {!result.items?.length && <p className="py-2 text-neutral-500">아직 기록이 없습니다. 설치 이후 이용 기록부터 점검합니다.</p>}
      </div>
      <div className="mt-2 flex items-center justify-end gap-2">
        <button type="button" disabled={busy || page === 0} onClick={() => setPage(p => p - 1)} className="rounded border px-2 py-1 disabled:opacity-40">이전</button>
        <span>{page + 1}페이지</span>
        <button type="button" disabled={busy || (page + 1) * 20 >= (result.total ?? 0)} onClick={() => setPage(p => p + 1)} className="rounded border px-2 py-1 disabled:opacity-40">다음</button>
      </div>
    </>}
  </section>;
}
