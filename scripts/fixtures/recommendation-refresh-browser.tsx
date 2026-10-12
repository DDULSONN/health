import { createRoot } from "react-dom/client";
import { StrictMode } from "react";
import MyPage from "../../app/mypage/page";
import Home from "../../app/community/dating/cards/page";
import CandidateImpression from "../../components/dating/CandidateImpression";
import { flushCandidateImpressions } from "../../lib/dating-1on1-impressions-client";

function ImpressionFixture() {
  return <div>
    <button onClick={() => void flushCandidateImpressions()}>검증 저장</button>
    <CandidateImpression ticket="fixture-ticket" candidateId="first" className="h-48">첫 후보</CandidateImpression>
    <div style={{ height: 1800 }} />
    <CandidateImpression ticket="fixture-ticket" candidateId="offscreen" className="h-48">화면 밖 후보</CandidateImpression>
    <details><summary>접힌 후보</summary><CandidateImpression ticket="fixture-ticket" candidateId="collapsed" className="h-48">접힌 안쪽</CandidateImpression></details>
    <div style={{ height: 1800 }} />
    <CandidateImpression ticket="fixture-ticket" candidateId="tall"><div style={{ height: 4500 }}>긴 모바일 후보</div></CandidateImpression>
  </div>;
}

// Test-only host: no real auth, keys, storage service or production APIs.
createRoot(document.getElementById("root")!).render(
  <StrictMode>{location.pathname === "/impressions-fixture" ? <ImpressionFixture /> : location.pathname === "/mypage" ? <MyPage /> : <Home />}</StrictMode>
);
