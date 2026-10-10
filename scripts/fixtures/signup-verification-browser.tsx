import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import SignupPage from "../../app/signup/page";
createRoot(document.getElementById("root")!).render(<StrictMode><SignupPage /></StrictMode>);
