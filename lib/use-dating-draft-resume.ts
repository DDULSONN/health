"use client";

import { useEffect, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { readDatingDraft } from "@/lib/dating-onboarding-draft";
import { summarizeDatingDraft, type DatingDraftResume } from "@/lib/dating-draft-resume";

/** Reuses the already verified home identity; no getUser, fetch, polling or server writes. */
export function useDatingDraftResume(userId: string | null, auth: SupabaseClient["auth"]) {
  const [draft, setDraft] = useState<DatingDraftResume | null>(null);
  useEffect(() => {
    let active = true;
    let identityMatches = Boolean(userId);
    const refresh = () => {
      if (!active) return;
      setDraft(identityMatches && userId ? summarizeDatingDraft(readDatingDraft(userId)) : null);
    };
    const { data } = auth.onAuthStateChange((_event, session) => {
      identityMatches = Boolean(userId && session?.user.id === userId);
      refresh();
    });
    const onVisible = () => { if (document.visibilityState === "visible") refresh(); };
    queueMicrotask(refresh);
    window.addEventListener("focus", refresh);
    window.addEventListener("pageshow", refresh);
    window.addEventListener("storage", refresh);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      active = false;
      data.subscription.unsubscribe();
      window.removeEventListener("focus", refresh);
      window.removeEventListener("pageshow", refresh);
      window.removeEventListener("storage", refresh);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [userId, auth]);
  return draft?.userId === userId ? draft : null;
}
