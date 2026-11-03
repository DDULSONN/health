/* eslint-disable @next/next/no-html-link-for-pages -- Standalone React fixture: role changes require a full document reload. */
import { createRoot } from "react-dom/client";
import { useEffect, useState } from "react";
import OneOnOneContactOffer from "@/components/dating/OneOnOneContactOffer";
import OneOnOneExchangedContact from "@/components/dating/OneOnOneExchangedContact";
import OneOnOnePrivateChat from "@/components/dating/OneOnOnePrivateChat";
import type { ExchangedContact, PayerContactChoice } from "@/lib/dating-private-contact";
const matchId="00000000-0000-4000-8000-000000000010";
const role=new URLSearchParams(location.search).get('role')==='recipient'?'recipient':'payer';
const originalFetch=window.fetch.bind(window);
window.fetch=(input,init={})=>{
  const url=new URL(String(input),location.origin);
  if(url.origin!==location.origin) return Promise.reject(new Error('로컬 미리보기에서는 외부 요청을 하지 않아요.'));
  const headers=new Headers(init.headers);headers.set('x-preview-role',role);
  return originalFetch(input,{...init,headers});
};
function App(){
  const [match,setMatch]=useState<(ExchangedContact&{contact_exchange_status:string})|null>(null);
  const [order,setOrder]=useState<{orderId:string;amount:number;choice?:PayerContactChoice}|null>(null);
  const [working,setWorking]=useState(false),[error,setError]=useState('');
  async function reload(){const r=await fetch('/api/dating/1on1/matches/my');const b=await r.json();if(!r.ok)throw Error(b.error);setMatch(b.items[0]);}
  useEffect(()=>{void reload().catch(e=>setError(e.message));},[]);
  async function exchange(_id:string,_offer?:string,choice?:PayerContactChoice){setWorking(true);setError('');try{
    const r=await fetch('/api/payments/toss/create',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({productType:'one_on_one_contact_exchange',matchId,payerContact:choice})});
    const b=await r.json();if(!r.ok)throw Error(b.message);setOrder({orderId:b.orderId,amount:b.amount,choice});
  }catch(e){setError((e as Error).message);}finally{setWorking(false);}}
  async function approve(){if(!order)return;setWorking(true);setError('');try{
    const r=await fetch('/api/payments/toss/confirm',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({orderId:order.orderId,paymentKey:'test_'+order.orderId,amount:order.amount})});
    const b=await r.json();if(!r.ok)throw Error(b.message);await reload();setOrder(null);
  }catch(e){setError((e as Error).message);}finally{setWorking(false);}}
  const chat=location.pathname.startsWith('/chat/');
  return <>
    <header className="border-b border-neutral-100 bg-white"><div className="mx-auto flex max-w-lg items-center justify-between px-5 py-5"><a className="text-xl font-black" href={'/?role='+role}>짐툴</a><span className="text-xs text-neutral-500">로컬 미리보기</span></div></header>
    <main className="mx-auto max-w-lg px-4 pb-20 pt-5">
      <nav className="mb-5 flex gap-2 rounded-xl bg-neutral-100 p-1 text-sm">
        <a className={`flex-1 rounded-lg py-2 text-center ${role==='payer'?'bg-white font-semibold shadow-sm':'text-neutral-500'}`} href="/?role=payer">결제자 화면</a>
        <a className={`flex-1 rounded-lg py-2 text-center ${role==='recipient'?'bg-white font-semibold shadow-sm':'text-neutral-500'}`} href="/?role=recipient">상대방 화면</a>
      </nav>
      <p className="mb-4 text-xs leading-5 text-neutral-500">가상 회원 · 로컬 DB · 실제 결제/문자 발송 없음</p>
      {chat?<OneOnOnePrivateChat matchId={matchId}/>:<section className="rounded-2xl border border-neutral-200 bg-white p-5">
        <div className="mb-5 flex items-start justify-between gap-3"><div><p className="text-base font-bold">{role==='payer'?'수빈':'지훈'} <span className="text-sm font-normal text-neutral-500">/ {role==='payer'?'29':'30'}세 / 서울</span></p><p className="mt-1 text-xs text-neutral-500">가상 프로필</p></div><span className="whitespace-nowrap rounded-full bg-emerald-50 px-2 py-1 text-[11px] font-semibold text-emerald-700">서로 수락</span></div>
        {error?<p role="alert" className="mb-3 text-sm text-red-600">{error}</p>:null}
        {order?<div className="rounded-xl border border-neutral-200 p-4">
          <p className="text-base font-semibold">공개할 연락처 확인</p><p className="mt-3 text-sm">상대에게 공개: <strong>{order.choice?'@'+order.choice.instagram:'내 휴대폰 번호'}</strong></p>
          <p className="mt-2 text-xs leading-5 text-neutral-500">{order.choice?'상대 번호는 그대로 확인하고 짐툴 채팅도 열려요.':'기존처럼 두 사람의 번호가 서로 공개돼요.'}</p>
          <p className="mt-4 text-lg font-bold">{order.amount.toLocaleString()}원</p><p className="mt-1 text-xs text-neutral-500">미리보기용 가상 승인 · 출금되지 않아요</p>
          <button disabled={working} onClick={()=>void approve()} className="mt-4 min-h-11 w-full rounded-xl bg-[#f0003d] text-sm font-semibold text-white disabled:opacity-40">{working?'처리 중':'가상 결제 승인'}</button>
          <button disabled={working} onClick={()=>setOrder(null)} className="mt-2 min-h-11 w-full text-xs text-neutral-500">돌아가기</button>
        </div>:match?.contact_exchange_status==='approved'?<>
          <p className="text-sm font-semibold">연락처 교환 완료</p><OneOnOneExchangedContact contact={match}/>
          <p className="mt-4 border-t border-neutral-100 pt-3 text-[11px] leading-5 text-neutral-500">외부 공유, 무단 저장, 불쾌한 연락은 제재 대상이에요.</p>
        </>:role==='payer'?<OneOnOneContactOffer matchId={matchId} name="수빈" included={false} processing={working} nudgeProcessing={false} onExchange={exchange} onNudge={()=>{}}/>:<p className="py-8 text-center text-sm text-neutral-500">결제자 화면에서 교환을 완료하면<br/>공개된 인스타와 채팅 버튼이 보여요.</p>}
      </section>}
      <button className="mt-5 text-xs text-neutral-400 underline" onClick={async()=>{await fetch('/api/preview/reset',{method:'POST'});location.href='/?role=payer';}}>가상 데이터 초기화</button>
    </main>
  </>;
}
createRoot(document.getElementById('root')!).render(<App/>);
