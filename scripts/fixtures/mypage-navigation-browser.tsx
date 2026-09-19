import { createRoot } from "react-dom/client";
import MyPage from "../../app/mypage/page";

// No production auth, secrets, services or writes are available in this fixture.
const originalFetch = window.fetch.bind(window);
window.fetch = (input, init) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, location.href);
  const method = init?.method ?? (input instanceof Request ? input.method : "GET");
  if (url.origin !== location.origin || method.toUpperCase() !== "GET") {
    return Promise.reject(new Error("UI fixture blocks all external requests and writes"));
  }
  url.searchParams.set("fixture", new URLSearchParams(location.search).get("fixture") || "populated");
  return originalFetch(url, init);
};
createRoot(document.getElementById("root")!).render(<>
  <aside className="bg-amber-50 p-2 text-center text-xs">로컬 UI 검증용 · 실제 계정 아님 · 저장/결제 불가</aside>
  <MyPage />
</>);
