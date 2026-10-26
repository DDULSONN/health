import { createRoot } from 'react-dom/client';
import ApplyCreditsPage from '../../app/dating/apply-credits/page';
import MoreViewPage from '../../app/dating/more-view/page';
import PaidDetail from '../../app/dating/paid/[id]/page';
import PaidApply from '../../app/dating/paid/[id]/apply/page';
import ApplicationCompleteNotice from '@/components/dating/ApplicationCompleteNotice';
import DatingPlusOffers from '@/components/dating/DatingPlusOffers';
const path = location.pathname;
createRoot(document.getElementById('root')!).render(<>
  <header className="border-b border-neutral-100 bg-white px-4 py-3 text-neutral-950">
    <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-2"><strong className="text-xl">짐툴</strong><span className="text-[11px] text-neutral-500">로컬 미리보기 · 가상 데이터 · 실제 결제·저장 없음</span></div>
    <nav className="mx-auto mt-2 flex max-w-3xl flex-wrap gap-4 text-xs text-neutral-600">
      <a className="inline-flex min-h-[44px] items-center" href="/dating/apply-credits">지원권</a>
      <a className="inline-flex min-h-[44px] items-center" href="/complete">지원 완료 화면</a>
      <a className="inline-flex min-h-[44px] items-center" href="/dating/paid/fixture-paid">공개 카드</a>
      <a className="inline-flex min-h-[44px] items-center" href="/dating/more-view">기존 열람권</a>
    </nav>
  </header>
  {path === '/complete' ? <ApplicationCompleteNotice historyHref="/mypage?section=matching&match=applied#paid-card-applied" listHref="/community/dating/cards?tab=open_cards" />
    : path === '/dating/more-view' ? <MoreViewPage />
    : path.endsWith('/fixture-paid/apply') ? <PaidApply />
    : path.endsWith('/fixture-paid') ? <PaidDetail />
    : path === '/plans' ? <main className="mx-auto max-w-md p-4"><DatingPlusOffers mode="one_on_one" placement="local_legacy_ux" oneOnOneCardId="fixture-one" /></main>
    : path === '/fixture-checkout' ? <main className="p-5">로컬 가상 결제창 도착 (실제 결제 없음)</main>
    : <ApplyCreditsPage />}
</>);
