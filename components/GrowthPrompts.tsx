"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import dynamic from "next/dynamic";
import { createClient } from "@/lib/supabase/client";
import { captureGrowthCampaign, dismissCompletionInvite, GROWTH_CHANGED, setGrowthUser, shouldShowCompletionInvite } from "@/lib/growth-analytics";

const ReferralInvitePanel = dynamic(() => import("@/components/ReferralInvitePanel"));

export default function GrowthPrompts() {
  const pathname = usePathname();
  const [userId, setUserId] = useState<string | null>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    captureGrowthCampaign(window.location.search);
    let id: string | null = null;
    const refresh = () => setVisible(shouldShowCompletionInvite(id));
    let unsubscribe = () => {};
    try {
      // Optional UI/measurement must not require an auth client during prerendering.
      const { data } = createClient().auth.onAuthStateChange((_event, session) => {
        id = session?.user.id ?? null;
        setGrowthUser(session?.user ?? null);
        setUserId(id);
        refresh();
      });
      unsubscribe = () => data.subscription.unsubscribe();
    } catch { /* Leave the prompt hidden if auth initialization is unavailable. */ }
    window.addEventListener(GROWTH_CHANGED, refresh);
    window.addEventListener("storage", refresh);
    return () => {
      unsubscribe();
      window.removeEventListener(GROWTH_CHANGED, refresh);
      window.removeEventListener("storage", refresh);
      setGrowthUser(null);
    };
  }, []);
  useEffect(() => { captureGrowthCampaign(window.location.search); }, [pathname]);
  // Preserve existing redirects to candidates/checkout. No interstitial or extra step.
  if (!visible || !userId || !["/community/dating/cards", "/mypage", "/onboarding/dating"].includes(pathname)) return null;
  return <aside aria-label="프로필 등록 후 친구 초대" className="mx-auto mt-2 w-[calc(100%-2rem)] max-w-5xl">
    <ReferralInvitePanel key={userId} compact placement="profile_complete" onDismiss={dismissCompletionInvite} />
  </aside>;
}
