import { createRoot } from "react-dom/client";
import Home from "../../app/community/dating/cards/page";

const guest = new URLSearchParams(location.search).get("fixture_auth") === "guest";
createRoot(document.getElementById("root")!).render(
  <>
    <header className="border-b border-neutral-100 bg-white px-4 py-3 text-sm text-neutral-700">
      <strong className="mr-2 font-black text-neutral-950">짐툴</strong>
      {guest ? "비회원" : "회원"} 미리보기 · 가상 데이터
    </header>
    <Home />
  </>,
);
