import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import AdminOnboardingFunnelPanel from "../../components/admin/AdminOnboardingFunnelPanel";
import ErrorPage from "../../app/error";
import PhonePage from "../../app/phone-verification/page";
const params = new URLSearchParams(location.search);
const error = Object.assign(new Error("PRIVATE_ERROR_MESSAGE_DO_NOT_RENDER"), { digest: "test-digest-1234" });
const reset = () => {
  const win = window as unknown as { fixtureResetCount?: number };
  win.fixtureResetCount = (win.fixtureResetCount || 0) + 1;
};
createRoot(document.getElementById("root")!).render(<StrictMode>
  {params.get("fixture") === "admin" ? <AdminOnboardingFunnelPanel /> :
    params.get("fixture") === "phone" ? <PhonePage /> : <ErrorPage error={error} reset={reset} />}
</StrictMode>);
