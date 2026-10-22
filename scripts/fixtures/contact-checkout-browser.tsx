import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import PaymentSuccessPage from "@/app/payments/success/page";
import OneOnOneContactOffer from "@/components/dating/OneOnOneContactOffer";

function Checkout() {
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const [message, setMessage] = useState("");
  const [items, setItems] = useState<Array<{id:string;counterparty_phone:string|null}>>([]);
  useEffect(() => { void fetch('/api/dating/1on1/matches/my').then(r=>r.json()).then(b=>setItems(b.items||[])); }, []);
  async function exchange(matchId:string) {
    if(lock.current)return;lock.current=true;setBusy(true);
    try {
      const r=await fetch('/api/payments/toss/create',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({productType:'one_on_one_contact_exchange',matchId})});
      const b=await r.json();if(!r.ok||!b.ok)throw Error(b.message||'결제 준비 실패');
      if(b.amount!==18000)throw Error('테스트 가격 불일치');
      window.location.assign(b.checkoutUrl);
    }catch(error){setMessage(error instanceof Error?error.message:'테스트 오류');lock.current=false;setBusy(false);}
  }
  return <main className="mx-auto max-w-md p-5">
    <h1 className="mb-4 text-xl font-semibold">번호교환 결제 검증</h1>
    {items[0]?.counterparty_phone
      ? <section className="rounded-xl border border-emerald-200 p-5"><h2>번호 교환 완료 · 가상 회원</h2><p className="mt-3 text-xl text-emerald-700">{items[0].counterparty_phone}</p></section>
      : <OneOnOneContactOffer matchId="00000000-0000-4000-8000-000000000010" name="테스트회원B" included={false} processing={busy} nudgeProcessing={false} onExchange={exchange} onNudge={()=>{}} />}
    {message?<p role="alert" className="mt-4 text-red-700">{message}</p>:null}
  </main>;
}
createRoot(document.getElementById('root')!).render(location.pathname==='/payments/success'?<PaymentSuccessPage/>:<Checkout/>);
