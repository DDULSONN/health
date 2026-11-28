import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import OpenCardApply from "../../app/community/dating/cards/[id]/apply/page";

// Actual applicant UI, local fake auth and no live storage or writes.
createRoot(document.getElementById("root")!).render(<StrictMode><OpenCardApply /></StrictMode>);
