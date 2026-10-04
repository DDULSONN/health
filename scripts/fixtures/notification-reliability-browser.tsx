import { StrictMode, useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import Notifications from "../../app/notifications/page";
import HeaderUserMenu from "../../components/HeaderUserMenu";
const subscribe = (fn: () => void) => { window.addEventListener("popstate", fn); return () => window.removeEventListener("popstate", fn); };
function Fixture() {
  const url = useSyncExternalStore(subscribe, () => location.pathname + location.search, () => "/notifications");
  return <>
    <aside className="p-2 text-center text-xs text-neutral-500">로컬 검증 · 가상 알림 · 운영 데이터 변경 없음</aside>
    <header className="flex items-center justify-between border-b p-4"><strong>짐툴</strong><div className="flex items-center"><HeaderUserMenu pathname={location.pathname} /></div></header>
    {url.startsWith("/notifications") ? <Notifications key={url} /> : <main className="p-6"><h1 className="text-xl font-bold">1:1 매칭 화면 이동 확인</h1><p className="mt-2 break-all text-sm">{url}</p></main>}
  </>;
}
createRoot(document.getElementById("root")!).render(<StrictMode><Fixture /></StrictMode>);
