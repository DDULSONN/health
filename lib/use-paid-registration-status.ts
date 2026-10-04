"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createLatestRequest } from "@/lib/latest-request";
import { fetchClientJson } from "@/lib/client-json-request";
import { parsePaidRegistrationStatus, paidRegistrationPresentation } from "@/lib/paid-registration-status";

export function usePaidRegistrationStatus(enabled: boolean, orderId?: string) {
  const request = useMemo(() => createLatestRequest(), []);
  const key = enabled ? orderId ?? "my-cards" : "disabled";
  const [snapshot, setSnapshot] = useState<{ key: string; data: NonNullable<ReturnType<typeof parsePaidRegistrationStatus>>; offset: number } | null>(null);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const reload = useCallback(() => {
    if (!enabled) return Promise.resolve();
    return request.run({
      start: () => { setLoading(true); setErrorKey(null); setSnapshot(null); },
      load: async (signal) => {
        const query = orderId === undefined ? "" : `?orderId=${encodeURIComponent(orderId)}`;
        const result = await fetchClientJson<unknown>(`/api/dating/paid/my/status${query}`, { cache: "no-store", signal });
        const data = parsePaidRegistrationStatus(result.body);
        if (!result.response.ok || !data) throw new Error("STATUS_UNAVAILABLE");
        return { key, data, offset: Date.parse(data.checked_at) - Date.now() };
      },
      commit: (value) => { setSnapshot(value); setNow(Date.now()); },
      fail: () => setErrorKey(key),
      finish: () => setLoading(false),
    });
  }, [enabled, orderId, key, request]);
  useEffect(() => {
    void reload();
    return () => request.cancel();
  }, [reload, request]);
  useEffect(() => {
    if (!enabled) return;
    // Only update the countdown locally; no background server polling.
    const update = () => setNow(Date.now());
    const timer = window.setInterval(update, 30_000);
    window.addEventListener("focus", update);
    return () => { window.clearInterval(timer); window.removeEventListener("focus", update); };
  }, [enabled]);
  const current = enabled && snapshot?.key === key ? snapshot : null;
  const card = current?.data.card ?? null;
  const presentation = card ? paidRegistrationPresentation(card, now + (current?.offset ?? 0)) : null;
  return { card, presentation, loading: enabled && (loading || (!current && errorKey !== key)), error: enabled && errorKey === key, reload, ready: Boolean(current) };
}
