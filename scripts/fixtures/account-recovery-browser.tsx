import { createRoot } from "react-dom/client";
import { StrictMode, useEffect, useState } from "react";
import RecoveryPage from "@/app/account-recovery/page";
import LoginPage from "@/app/login/page";
import CallbackPage from "@/app/auth/callback/page";
import ResetPasswordPage from "@/app/auth/reset-password/page";
const pathname = window.location.pathname;
const Page = pathname === "/account-recovery" ? RecoveryPage : pathname === "/auth/callback" ? CallbackPage : pathname === "/auth/reset-password" ? ResetPasswordPage : LoginPage;
function Diagnostics() {
  const [status, setStatus] = useState("");
  useEffect(() => {
    const timer = window.setInterval(() => {
      const fixture = (window as unknown as { recoveryFixture: { signedIn: boolean; calls: { action: string }[]; redirect?: string } }).recoveryFixture;
      setStatus(JSON.stringify({ signedIn: fixture.signedIn, signOuts: fixture.calls.filter(call => call.action === "signOut").length, redirect: fixture.redirect ?? null }));
    }, 100);
    return () => window.clearInterval(timer);
  }, []);
  return <output aria-label="로컬 인증 검사 결과" className="block break-all border-t p-4 text-xs">{status}</output>;
}
createRoot(document.getElementById("root")!).render(<StrictMode><Page /><Diagnostics /></StrictMode>);
