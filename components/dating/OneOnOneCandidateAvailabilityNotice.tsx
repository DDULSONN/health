"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { fetchClientJson } from "@/lib/client-json-request";
import { eligibleForSingleCandidateRefresh, type SingleCandidateRefreshFields, type SingleCandidateRefreshNotice } from "@/lib/use-one-on-one-candidate-replace";

const AVAILABILITY_CHECK_MS = 3 * 60 * 1000;
type Group = SingleCandidateRefreshFields & { recommendations?: Array<{ id?: string }>; new_candidate_notice?: { state: string } | null };

export function firstWaitingSingleCandidateGroup<T extends Group>(groups: T[], notice?: SingleCandidateRefreshNotice | null) {
  return groups.find(group => (group.new_candidate_notice?.state === "waiting" ||
    (notice?.noCandidateGeneration && notice.sourceCardId === group.source_card_id && notice.noCandidateGeneration === group.single_refresh_generation)) &&
    group.recommendations?.some(card => card.id && eligibleForSingleCandidateRefresh(group, card.id)));
}

export default function OneOnOneCandidateAvailabilityNotice({ group, viewerId, identity, onRead }: {
  group: Group | null | undefined;
  viewerId: string | null | undefined;
  identity: RefObject<string | null> | undefined;
  onRead?: () => void;
}) {
  const source = group?.source_card_id;
  const generation = group?.single_refresh_generation;
  const receipt = group?.impression_ticket;
  // The main list may have been filtered locally (hide/report); an eligible
  // ID alone is not a reason to check availability for a card not on screen.
  const visibleRepeatedIds = (group?.recommendations ?? []).flatMap(card =>
    card.id && eligibleForSingleCandidateRefresh(group, card.id) ? [card.id] : []).sort().join(":");
  const probeCandidateId = visibleRepeatedIds.split(":")[0];
  const key = viewerId && source && generation && visibleRepeatedIds ? JSON.stringify([viewerId, source, generation, visibleRepeatedIds, receipt]) : "";
  const [notice, setNotice] = useState<{ key: string; refreshList: boolean } | null>(null);
  const readLocked = useRef(false);

  useEffect(() => {
    if (!key || !source || !generation || !viewerId || !identity || !receipt || !probeCandidateId) return;
    const query = new URLSearchParams({ source_card_id: source, generation_key: generation, probe_candidate_id: probeCandidateId });
    let live = true;
    let nextCheckAt = Date.now() + AVAILABILITY_CHECK_MS;
    let misses = 0;
    let done = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let request: AbortController | undefined;

    function canCheck() {
      return live && !done && identity?.current === viewerId && document.visibilityState === "visible" && navigator.onLine;
    }
    function schedule() {
      clearTimeout(timer);
      if (canCheck()) timer = setTimeout(check, Math.max(0, nextCheckAt - Date.now()));
    }
    async function check() {
      if (!canCheck() || request) return;
      if (Date.now() < nextCheckAt) { schedule(); return; }
      nextCheckAt = Date.now() + AVAILABILITY_CHECK_MS;
      let retryAfterMs = 0;
      const controller = new AbortController();
      request = controller;
      try {
        const { response, body } = await fetchClientJson<{ available?: unknown; generation_key?: unknown; refresh_list?: unknown }>(
          `/api/dating/1on1/recommendations/replace?${query}`, {
            method: "GET", credentials: "same-origin", cache: "no-store", signal: controller.signal,
            headers: { "X-Jimtul-Candidate-Receipt": receipt! },
          }, 8_000,
        );
        if (canCheck() && !controller.signal.aborted) {
          readLocked.current = false;
          const available = response.ok && body?.available === true && body.generation_key === generation;
          done = available || response.status === 401 || response.status === 403 || response.status === 409;
          if (response.status === 429) {
            const seconds = Number(response.headers.get("Retry-After"));
            if (Number.isFinite(seconds) && seconds > 0) retryAfterMs = Math.min(seconds, 900) * 1000;
          }
          setNotice(available ? { key, refreshList: body.refresh_list === true } : null);
        }
      } catch {
        if (canCheck() && !controller.signal.aborted) setNotice(null);
      } finally {
        if (request === controller) {
          request = undefined;
          misses++;
          nextCheckAt = Date.now() + Math.max(retryAfterMs, AVAILABILITY_CHECK_MS * (misses >= 2 ? 3 : 1));
          schedule();
        }
      }
    }
    function onViewState() {
      if (canCheck()) { schedule(); return; }
      clearTimeout(timer);
      request?.abort();
      request = undefined;
    }
    schedule();
    window.addEventListener("focus", schedule);
    window.addEventListener("online", onViewState);
    window.addEventListener("offline", onViewState);
    document.addEventListener("visibilitychange", onViewState);
    return () => {
      live = false;
      clearTimeout(timer);
      request?.abort();
      window.removeEventListener("focus", schedule);
      window.removeEventListener("online", onViewState);
      window.removeEventListener("offline", onViewState);
      document.removeEventListener("visibilitychange", onViewState);
    };
  }, [key, source, generation, viewerId, identity, probeCandidateId, receipt]);

  return key && notice?.key === key ? <div className="mt-2 flex flex-wrap items-center gap-x-3 text-xs font-medium leading-5 text-emerald-800">
    <p role="status" data-single-refresh-available>조건에 맞는 새 후보가 있어요</p>
    {notice.refreshList && onRead ? <button type="button" className="min-h-11 font-semibold underline underline-offset-2"
      onClick={() => {
        if (identity?.current !== viewerId || readLocked.current) return;
        readLocked.current = true;
        setNotice(null);
        onRead();
      }}>새 후보 확인</button> : null}
  </div> : null;
}
