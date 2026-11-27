import React from "react";
import { createRoot } from "react-dom/client";
import ContactPaymentOrderCheck from "@/components/dating/ContactPaymentOrderCheck";

createRoot(document.getElementById("root")!).render(
  <ContactPaymentOrderCheck orderId="fixture_order_123" matchId="aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa" />,
);
