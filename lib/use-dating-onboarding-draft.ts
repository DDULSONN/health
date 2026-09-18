"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { clearDatingDraft, readDatingDraft, writeDatingDraft, type DatingDraft } from "@/lib/dating-onboarding-draft";

type Snapshot = Pick<DatingDraft, "step" | "targets" | "fields">;

export function useDatingOnboardingDraft(userId: string | null, snapshot: Snapshot, enabled: boolean) {
  const [pendingDraft, setPendingDraft] = useState<DatingDraft | null>(null);
  const [ready, setReady] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saved" | "unavailable">("idle");
  const stopped = useRef(false);
  const latest = useRef({ userId, snapshot, enabled, ready, pendingDraft });
  useLayoutEffect(() => { latest.current = { userId, snapshot, enabled, ready, pendingDraft }; });

  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      stopped.current = false;
      setPendingDraft(userId ? readDatingDraft(userId) : null);
      setReady(Boolean(userId));
      setSaveStatus("idle");
    });
    return () => { active = false; };
  }, [userId]);

  const flush = useCallback(() => {
    const state = latest.current;
    if (stopped.current || !state.userId || !state.enabled || !state.ready || state.pendingDraft) return null;
    return writeDatingDraft({ version: 1, userId: state.userId, savedAt: Date.now(), ...state.snapshot });
  }, []);

  // A small local write only after edits settle; no autosave API calls.
  const snapshotKey = JSON.stringify(snapshot);
  useEffect(() => {
    if (!enabled || !ready || pendingDraft) return;
    const timer = window.setTimeout(() => {
      const saved = flush();
      if (saved !== null) setSaveStatus(saved ? "saved" : "unavailable");
    }, 500);
    return () => window.clearTimeout(timer);
  }, [snapshotKey, enabled, ready, pendingDraft, flush]);

  useEffect(() => {
    const save = () => { flush(); };
    const onVisibility = () => { if (document.visibilityState === "hidden") save(); };
    window.addEventListener("pagehide", save);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      save();
      window.removeEventListener("pagehide", save);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [flush]);

  const finish = useCallback(() => {
    stopped.current = true;
    if (latest.current.userId) clearDatingDraft(latest.current.userId);
  }, []);

  const discard = () => {
    if (userId) clearDatingDraft(userId);
    setPendingDraft(null);
    setSaveStatus("idle");
  };

  return { pendingDraft, ready, saveStatus, finish, discard, resumed: () => setPendingDraft(null) };
}
