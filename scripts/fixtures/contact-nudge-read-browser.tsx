import React, {useEffect, useState} from "react";
import {createRoot} from "react-dom/client";
import OneOnOneContactNudge from "../../components/dating/OneOnOneContactNudge";
import OneOnOneContactOffer from "../../components/dating/OneOnOneContactOffer";
import type {OneOnOneContactNudgeSummary} from "../../lib/dating-1on1-contact-nudge";

const params = new URLSearchParams(location.search);
const mode = params.get("mode") || "receiver";
const matchId = "00000000-0000-4000-8000-000000000010";
function App() {
  const [nudge, setNudge] = useState<OneOnOneContactNudgeSummary | null>(null);
  const [covered, setCovered] = useState(mode === "covered");
  const load = async () => {
    const res = await fetch("/api/test-summary?role=" + (mode === "sender" ? "sender" : "recipient"));
    const data = await res.json();setNudge(data.items[0]?.contact_nudge ?? null);
  };
  useEffect(() => {
    let disposed = false;
    void fetch("/api/test-summary?role=" + (mode === "sender" ? "sender" : "recipient"))
      .then(res => res.json()).then(data => {if (!disposed) setNudge(data.items[0]?.contact_nudge ?? null);});
    return () => {disposed = true;};
  }, []);
  const card = <OneOnOneContactNudge matchId={matchId} nudge={nudge} processing={false}
    onSend={() => {throw Error("Must not send a new nudge");}} />;
  return <main style={{maxWidth:440,margin:"0 auto",padding:12}}>
    {mode === "sender" ? <button onClick={() => void load()}>상태 다시 확인</button> : null}
    {mode === "offscreen" ? <div style={{height:1800}}>아래로 스크롤</div> : null}
    {mode === "collapsed" ? <details><summary>매칭 열기</summary>{card}</details> :
      mode === "offer" ? <OneOnOneContactOffer matchId={matchId} nudge={nudge} included processing={false} nudgeProcessing={false}
        onExchange={() => {throw Error("Must not exchange");}} onNudge={() => {throw Error("Must not send");}} /> : card}
    {covered ? <div style={{position:"fixed",inset:0,zIndex:100,background:"white"}}><button onClick={() => setCovered(false)}>덮개 닫기</button></div> : null}
  </main>;
}
createRoot(document.getElementById("root")!).render(<App />);
