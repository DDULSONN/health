import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import ReturnProfileRewardBanner from "@/components/ReturnProfileRewardBanner";
import OpenCardExtras from "@/components/dating/OpenCardExtras";
import ApplyCreditsPage from "@/app/dating/apply-credits/page";
import { fixtureAuth } from "./return-reward-adapters";
import { notifyApplyCreditBalanceChanged } from "@/lib/apply-credit-balance-events";

function Fixture() {
  const [userId, setUserId] = useState<string | null>("return-member");
  useEffect(() => {
    Object.assign(window, { creditFixture: {
      auth(id: string | null) { fixtureAuth(id); setUserId(id); },
      invalidate: notifyApplyCreditBalanceChanged,
    } });
  }, []);
  return <><ReturnProfileRewardBanner />{location.pathname === "/dating/apply-credits"
    ? <ApplyCreditsPage /> : <OpenCardExtras userId={userId} />}</>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);
