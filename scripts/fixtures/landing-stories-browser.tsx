import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import LandingPage from "../../app/landing/page";
import Signup from "../../app/signup/page";

// Actual landing JSX, with the server data dependency replaced by the no-network adapter.
async function renderPreview() {
  const content = location.pathname === "/signup" ? <Signup /> :
    location.pathname === "/login" ? <main><h1>기존 로그인 화면으로 연결</h1><p>{location.search}</p></main> :
    location.pathname === "/community/dating/cards" ? <main><h1>오픈카드 목록으로 연결</h1></main> : await LandingPage();
  createRoot(document.getElementById("root")!).render(<StrictMode>{content}</StrictMode>);
}
void renderPreview();
