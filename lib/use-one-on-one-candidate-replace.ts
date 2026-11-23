"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { fetchClientJson } from "@/lib/client-json-request";

export type SingleCandidateRefreshFields = {
  source_card_id?: string;
  single_refresh_generation?: string | null;
  single_refresh_candidate_ids?: string[];
  impression_ticket?: string | null;
};

export type SingleCandidateRefreshNotice = {
  sourceCardId: string;
  message: string;
  noCandidateGeneration?: string | null;
};

export function eligibleForSingleCandidateRefresh(group: SingleCandidateRefreshFields | null | undefined, candidateId: string) {
  return Boolean(candidateId && group?.source_card_id && typeof group.single_refresh_generation === "string" && group.single_refresh_generation &&
    typeof group.impression_ticket === "string" && group.impression_ticket &&
    Array.isArray(group.single_refresh_candidate_ids) && group.single_refresh_candidate_ids.includes(candidateId));
}

type Options = {
  identity: RefObject<string | null>;
  viewerId: string | null;
  locks: RefObject<Set<string>>;
  needsReload: RefObject<boolean>;
  reload: () => Promise<unknown>;
  onReadFailure: (message: string) => void;
};

export function useOneOnOneCandidateReplace({ identity, viewerId, locks, needsReload, reload, onReadFailure }: Options) {
  const [busy, setBusy] = useState<{ userId: string; sourceCardId: string; candidateId: string } | null>(null);
  const [notice, setNotice] = useState<(SingleCandidateRefreshNotice & { userId: string }) | null>(null);
  const active = useRef<AbortController | null>(null);
  useEffect(() => () => active.current?.abort(), []);

  const replace = async (group: SingleCandidateRefreshFields, candidateId: string) => {
    const userId = identity.current;
    const sourceCardId = group.source_card_id;
    if (!userId || userId !== viewerId || !sourceCardId || !eligibleForSingleCandidateRefresh(group, candidateId) || active.current ||
      needsReload.current || locks.current.has(sourceCardId)) return;

    const controller = new AbortController();
    active.current = controller;
    const locked = locks.current;
    locked.add(sourceCardId);
    const isCurrent = () => identity.current === userId && !controller.signal.aborted;
    setNotice(null);
    setBusy({ userId, sourceCardId, candidateId });
    try {
      let changed = false;
      try {
        const { response, body } = await fetchClientJson<{ ok?: boolean; changed?: boolean; code?: string; error?: string }>(
          "/api/dating/1on1/recommendations/replace", {
            method: "POST", cache: "no-store", signal: controller.signal, headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ source_card_id: sourceCardId, candidate_card_id: candidateId,
              generation_key: group.single_refresh_generation, impression_ticket: group.impression_ticket }),
          }, 15_000,
        );
        if (!isCurrent()) return;
        const unchangedMessage = body?.code === "NO_UNSEEN_CANDIDATE" ? "조건에 맞는 새 후보를 아직 찾지 못했어요. 지금 후보는 그대로예요."
          : body?.code === "SINGLE_REFRESH_LIMIT" ? "최근 24시간 동안 한 명씩 바꾸기를 모두 사용했어요. 현재 후보는 그대로예요."
          : body?.code === "SINGLE_REFRESH_SLOW_DOWN" ? "잠시 후 다시 눌러 주세요. 현재 후보는 그대로예요." : null;
        if (response.status < 500 && unchangedMessage) {
          setNotice({ userId, sourceCardId, message: unchangedMessage,
            ...(body?.code === "NO_UNSEEN_CANDIDATE" ? { noCandidateGeneration: group.single_refresh_generation } : {}) });
          return;
        }
        changed = response.ok && body?.ok === true && body.changed === true;
      } catch { /* An uncertain mutation is followed by a read, never a second POST. */ }
      if (!isCurrent()) return;

      needsReload.current = true;
      try {
        await reload();
        if (isCurrent()) {
          setNotice({ userId, sourceCardId, message: changed ? "이 후보 한 명을 새 후보로 바꿨어요." : "명단을 다시 불러왔어요. 현재 후보를 확인해 주세요." });
        }
      } catch {
        if (isCurrent()) onReadFailure(changed
          ? "후보는 교체됐지만 명단을 불러오지 못했어요. '명단 다시 불러오기'로 확인해 주세요."
          : "교체 결과를 확인하지 못했어요. 다시 교체하지 말고 '명단 다시 불러오기'로 확인해 주세요.");
      }
    } finally {
      locked.delete(sourceCardId);
      if (active.current === controller) active.current = null;
      if (isCurrent()) setBusy(null);
    }
  };
  return { replace, busy: busy?.userId === viewerId ? busy : null, notice: notice?.userId === viewerId ? notice : null };
}
