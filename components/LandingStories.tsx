"use client";

import { useEffect, useId, useRef, useState } from "react";
import { LANDING_REVIEWS } from "@/lib/landing-reviews";

export default function LandingStories() {
  const headingId = useId();
  const dialogId = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLButtonElement | null>(null);
  const rail = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [paused, setPaused] = useState(false);
  const [failed, setFailed] = useState<string[]>([]);
  const current = selected === null ? null : LANDING_REVIEWS[selected];

  useEffect(() => {
    if (selected === null) return;
    const element = dialog.current;
    if (!element) return;
    element.showModal();
    const previousOverflow = document.body.style.overflow;
    const trigger = opener.current;
    document.body.style.overflow = "hidden";
    return () => {
      element.close();
      document.body.style.overflow = previousOverflow;
      if (trigger?.isConnected) trigger.focus({ preventScroll: true });
    };
  }, [selected]);

  const openReview = (index: number, trigger: HTMLButtonElement) => {
    if (typeof dialog.current?.showModal !== "function") {
      window.open(LANDING_REVIEWS[index].src, "_blank", "noopener,noreferrer");
      return;
    }
    opener.current = trigger;
    setFailed(items => items.filter(src => src !== LANDING_REVIEWS[index].src));
    setSelected(index);
  };

  return <div className="landing-stories" aria-labelledby={headingId}>
    <div className="landing-stories-heading">
      <h1 id={headingId}>실제 리뷰</h1>
      <button type="button" aria-label={paused ? "후기 자동 이동 재생" : "후기 자동 이동 일시정지"}
        onClick={() => { if (rail.current) rail.current.scrollLeft = 0; setPaused(value => !value); }}>
        {paused ? "재생" : "일시정지"}
      </button>
    </div>
    <div ref={rail} className="landing-stories-rail" data-manual={paused} aria-label="실제 후기 사진">
      <div className="landing-stories-track" data-open={selected !== null}>
        {[false, true].map(duplicate => <div key={String(duplicate)} className="landing-stories-group" aria-hidden={duplicate || undefined}>
          {LANDING_REVIEWS.map((review, index) => <button key={review.src} type="button" className="landing-stories-card"
            tabIndex={duplicate ? -1 : 0} aria-label={`회원 후기 ${index + 1} 원문 보기`}
            onClick={event => openReview(index, event.currentTarget)}>
            {failed.includes(review.src) ? <span>후기 {index + 1} · 눌러서 다시 확인</span> :
              // Existing static WebP only; preserve the original screenshots and aspect ratios.
              // eslint-disable-next-line @next/next/no-img-element
              <img src={review.src} width={review.width} height={review.height} alt={`짐툴 실제 리뷰 스크린샷 ${index + 1}`}
                loading={index < 3 && !duplicate ? "eager" : "lazy"} decoding="async"
                onError={() => setFailed(items => items.includes(review.src) ? items : [...items, review.src])} />}
          </button>)}
        </div>)}
      </div>
    </div>
    <p className="landing-stories-hint">사진을 누르면 크게 볼 수 있어요.</p>
    <p className="landing-stories-note">리뷰 속 유기견은 인스타그램 크리에이터 일반사람이 쓰는 표현으로, 헬스는 열심히 하지만 아직 연애는 못 하고 있는 사람을 뜻하는 농담이에요.</p>
    <dialog ref={dialog} className="landing-stories-dialog" aria-labelledby={dialogId}
      onCancel={event => { event.preventDefault(); setSelected(null); }}
      onClose={event => { if (!event.currentTarget.open) setSelected(null); }}
      onClick={event => { if (event.target === event.currentTarget) setSelected(null); }}>
      <header><h2 id={dialogId}>회원이 보내주신 후기</h2><button type="button" onClick={() => setSelected(null)}>닫기</button></header>
      {current ? failed.includes(current.src) ? <p role="status">후기 이미지를 불러오지 못했어요. 닫은 뒤 다시 확인해 주세요.</p> :
        // eslint-disable-next-line @next/next/no-img-element
        <img src={current.src} width={current.width} height={current.height} alt="회원이 보내주신 후기 원문"
          onError={() => setFailed(items => items.includes(current.src) ? items : [...items, current.src])} /> : null}
      <p>기존에 공개된 후기 원문이에요. 개인의 경험이며 만남을 보장하지 않아요.</p>
    </dialog>
    <style>{STYLES}</style>
  </div>;
}

const STYLES = `
.landing-stories { min-width: 0; color: #202024; }
.landing-stories-heading { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 8px; }
.landing-stories-heading h1 { margin: 0; font-size: 13px; font-weight: 700; color: #707078; }
.landing-stories-heading button { min-height: 32px; padding: 4px 0 4px 8px; border: 0; background: transparent; color: #89848b; font-size: 11px; cursor: pointer; }
.landing-stories-rail { overflow: hidden; border-radius: 12px; }
.landing-stories-track { display: flex; width: max-content; animation: landing-stories-drift 90s linear infinite; }
.landing-stories-group { display: flex; flex: 0 0 auto; gap: 12px; padding-right: 12px; }
.landing-stories .landing-stories-card { display: flex; align-items: center; justify-content: center; flex: 0 0 auto; width: clamp(256px, 34vw, 352px); height: clamp(140px, 16vw, 180px); padding: 7px; overflow: hidden; border: 1px solid #e7e5e7; border-radius: 12px; background: #f8f8f9; color: #625c65; cursor: zoom-in; }
.landing-stories-card img { width: 100%; height: 100%; object-fit: contain; border-radius: 7px; }
.landing-stories button:focus-visible { outline: 2px solid #ed174c; outline-offset: -3px; }
.landing-stories-track[data-open="true"], .landing-stories-track:focus-within { animation-play-state: paused; }
.landing-stories-rail[data-manual="true"], .landing-stories-rail:has(:focus-visible) { overflow-x: auto; }
.landing-stories-rail[data-manual="true"] .landing-stories-track, .landing-stories-track:has(:focus-visible) { animation: none; }
.landing-stories-rail[data-manual="true"] .landing-stories-group[aria-hidden="true"] { display: none; }
.landing-stories-hint { margin: 7px 0; color: #89848b; font-size: 11px; }
.landing-stories-note { max-width: 608px; margin: 0; color: #8a8a91; font-size: 11px; line-height: 1.55; }
.landing-stories-dialog { position: fixed; inset: 0; margin: auto; width: calc(100% - 32px); max-width: 720px; max-height: 85dvh; padding: 16px; border: 1px solid #e7e5e7; border-radius: 18px; background: #fff; color: #202024; overflow: auto; }
.landing-stories-dialog::backdrop { background: rgb(0 0 0 / 60%); }
.landing-stories-dialog header { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 12px; }
.landing-stories-dialog h2 { margin: 0; font-size: 14px; font-weight: 650; }
.landing-stories-dialog header button { min-height: 44px; padding: 8px 12px; border: 1px solid #e7e5e7; border-radius: 10px; background: #fff; font-size: 13px; cursor: pointer; }
.landing-stories-dialog img { display: block; width: 100%; height: auto; object-fit: contain; }
.landing-stories-dialog p { margin: 12px 0 0; font-size: 11px; line-height: 1.6; color: #79727e; }
@keyframes landing-stories-drift { to { transform: translateX(-50%); } }
@media (hover: hover) and (pointer: fine) { .landing-stories-rail:hover .landing-stories-track { animation-play-state: paused; } }
@media (prefers-reduced-motion: reduce) { .landing-stories-track { animation: none; } .landing-stories-rail { overflow-x: auto; } .landing-stories-group[aria-hidden="true"] { display: none; } .landing-stories-heading button { display: none; } }
`;
