import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import Home from "../../app/community/dating/cards/page";
import Paid from "../../app/dating/paid/page";
import PaymentSuccess from "../../app/payments/success/page";
import PaidApply from "../../app/dating/paid/[id]/apply/page";
if (new URLSearchParams(location.search).get('scenario') === 'auth-error') {
  (window as unknown as { fixtureAuthMode: string }).fixtureAuthMode = 'server-error';
}
createRoot(document.getElementById("root")!).render(<StrictMode>
  {location.pathname === "/dating/paid/fixture-paid/apply" ? <PaidApply /> : location.pathname === "/payments/success" ? <PaymentSuccess /> : location.pathname === "/dating/paid" ? <Paid /> : <Home />}
</StrictMode>);
