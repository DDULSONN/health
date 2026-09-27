"use client";
import { useState } from "react";
import { createRoot } from "react-dom/client";
import AdminUserContactExchangesPanel from "../../components/admin/AdminUserContactExchangesPanel";

function Fixture() {
  const [member, setMember] = useState("00000000-0000-4000-8000-000000000001");
  const [closed, setClosed] = useState("");
  return <main className="mx-auto max-w-2xl space-y-4 p-3">
    <h1 className="text-lg font-bold">관리자 회원관리 · 로컬 검증</h1>
    <button onClick={() => setMember("00000000-0000-4000-8000-000000000002")}>다른 회원 조회</button>
    <AdminUserContactExchangesPanel userId={member} onClosed={setClosed} />
    <p data-testid="closed-id">{closed}</p>
  </main>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);
