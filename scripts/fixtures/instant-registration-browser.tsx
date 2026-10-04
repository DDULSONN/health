import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import Home from "../../app/community/dating/cards/page";
import Paid from "../../app/dating/paid/page";
import PaymentSuccess from "../../app/payments/success/page";
createRoot(document.getElementById("root")!).render(<StrictMode>
  {location.pathname === "/payments/success" ? <PaymentSuccess /> : location.pathname === "/dating/paid" ? <Paid /> : <Home />}
</StrictMode>);
