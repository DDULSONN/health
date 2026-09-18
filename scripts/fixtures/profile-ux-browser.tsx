// Isolated test host for the real page. No real accounts, storage or network APIs.
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import Page from "../../app/onboarding/dating/page";
createRoot(document.getElementById("root")!).render(<StrictMode><Page /></StrictMode>);
