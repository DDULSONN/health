import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import OneOnOne from "../../app/dating/1on1/page";
import OpenCard from "../../app/community/dating/cards/new/page";

// Actual editors, isolated from live authentication, accounts and mutations.
createRoot(document.getElementById("root")!).render(<StrictMode>
  {location.pathname === "/dating/card/new" ? <OpenCard /> : <OneOnOne />}
</StrictMode>);
