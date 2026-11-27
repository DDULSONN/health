import React from "react";
import { createRoot } from "react-dom/client";
import AdminOperationsPanel from "@/components/admin/AdminOperationsPanel";

createRoot(document.getElementById("root")!).render(
  <main className="p-3"><AdminOperationsPanel /></main>,
);
