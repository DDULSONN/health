import { useState } from "react";
import { createRoot } from "react-dom/client";
import AdminContactVoucherPanel from "@/components/admin/AdminContactVoucherPanel";
function Fixture() {
  const [member,setMember]=useState("00000000-0000-4000-8000-000000000001");
  return <main className="mx-auto max-w-lg space-y-3 p-3"><h1 className="text-lg font-bold">회원 관리 · 로컬 검증</h1>
    <p className="text-xs text-neutral-500">가상 회원으로 검증하는 화면입니다. 실제 지급은 하지 않습니다.</p>
    <button onClick={()=>setMember("00000000-0000-4000-8000-000000000002")}>다른 회원 선택</button>
    <AdminContactVoucherPanel userId={member}/></main>;
}
createRoot(document.getElementById("root")!).render(<Fixture/>);
