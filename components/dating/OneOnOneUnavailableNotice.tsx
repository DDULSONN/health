"use client";
import { useEffect, useState } from "react";
import { fetchClientJson } from "@/lib/client-json-request";
import { oneOnOneLookupNotice, type OneOnOneStatusNotice } from "@/lib/dating-1on1-notification-status";

export default function OneOnOneUnavailableNotice({ matchId }: { matchId: string }) {
  const [result, setResult] = useState<{ id: string; notice: OneOnOneStatusNotice; retry: boolean } | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setResult(null);
    void (async () => {
      try {
        const { response, body } = await fetchClientJson<{ notice?: OneOnOneStatusNotice }>(
          `/api/dating/1on1/matches/${encodeURIComponent(matchId)}/status`, { cache: "no-store", signal: controller.signal },
        );
        if (controller.signal.aborted) return;
        if (response.status === 401) {
          setResult({ id: matchId, notice: { title: "로그인 상태를 확인해 주세요", body: "알림을 받은 계정으로 로그인한 뒤 다시 확인해 주세요." }, retry: true }); return;
        }
        if ((!response.ok && response.status !== 404) || typeof body?.notice?.title !== "string" || typeof body.notice.body !== "string") throw Error("status unavailable");
        setResult({ id: matchId, notice: body.notice, retry: false });
      } catch {
        if (!controller.signal.aborted) setResult({ id: matchId, notice: oneOnOneLookupNotice(), retry: true });
      }
    })();
    return () => controller.abort();
  }, [matchId, attempt]);
  const current = result?.id === matchId ? result : null;
  return <div role="status" className="rounded-xl border border-neutral-200 bg-neutral-50 p-4 text-sm text-neutral-700">
    <p className="font-semibold">{current?.notice.title ?? "매칭 상태를 확인하고 있어요"}</p>
    {current ? <p className="mt-2 text-xs leading-5">{current.notice.body}</p> : null}
    {current?.retry ? <button type="button" onClick={() => setAttempt(value => value + 1)}
      className="mt-2 min-h-[44px] rounded-lg border border-neutral-300 bg-white px-3 text-xs">상태 다시 확인</button> : null}
  </div>;
}
