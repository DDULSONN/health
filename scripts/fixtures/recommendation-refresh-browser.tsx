import { createRoot } from "react-dom/client";
import { StrictMode } from "react";
import MyPage from "../../app/mypage/page";
import Home from "../../app/community/dating/cards/page";

// Test-only host: no real auth, keys, storage service or production APIs.
createRoot(document.getElementById("root")!).render(
  <StrictMode>{location.pathname === "/mypage" ? <MyPage /> : <Home />}</StrictMode>
);
