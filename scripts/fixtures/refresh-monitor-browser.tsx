import React from "react";
import { createRoot } from "react-dom/client";
import AdminRefreshMonitorPanel from "@/components/admin/AdminRefreshMonitorPanel";

createRoot(document.getElementById("root")!).render(<React.StrictMode>
  <main className="mx-auto max-w-3xl p-3"><AdminRefreshMonitorPanel /></main>
</React.StrictMode>);
