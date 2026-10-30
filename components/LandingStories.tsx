"use client";

import { useEffect, useId, useRef, useState } from "react";
import { FEATURED_LANDING_REVIEWS, LANDING_REVIEWS } from "@/lib/landing-reviews";

export default function LandingStories() {
  const headingId = useId();
  const dialogId = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLButtonElement | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [allOpen, setAllOpen] = useState(false);
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
      <div>
        <p>회원들이 보내온 이야기</p>
        <h1 id={headingId}>짐툴에서 시작된 만남</h1>
      </div>
      <span className="landing-stories-swipe">옆으로 넘겨보세요 →</span>
    </div>
    <div className="landing-stories-cards" aria-label="실제 후기 3개">
      {FEATURED_LANDING_REVIEWS.map(({ review, quote }) => {
        const index = LANDING_REVIEWS.indexOf(review);
        return <button type="button" className="landing-stories-card" key={review.src}
          aria-label={`${quote} · 후기 원문 보기`} onClick={event => openReview(index, event.currentTarget)}>
          <span className="landing-stories-quote">“{quote}”</span>
          <span className="landing-stories-card-foot"><span>회원 후기 중 일부</span><span>원문 보기 ↗</span></span>
        </button>;
      })}
    </div>
    <div className="landing-stories-meta">
      <span>개인의 경험으로, 만남의 결과는 다를 수 있어요.</span>
      <button type="button" aria-expanded={allOpen} aria-controls={`${headingId}-all`}
        onClick={() => setAllOpen(value => !value)}>{allOpen ? "후기 접기 −" : "후기 더 보기 +"}</button>
    </div>
    <div id={`${headingId}-all`} hidden={!allOpen}>
      {allOpen ? <div className="landing-stories-gallery">
        {LANDING_REVIEWS.map((review, index) => <button key={review.src} type="button"
          aria-label={`회원 후기 ${index + 1} 원문 보기`} onClick={event => openReview(index, event.currentTarget)}>
          {failed.includes(review.src) ? <span>후기 {index + 1} · 이미지 확인 불가</span> :
            // Existing static WebP only; no originals, member APIs or new image transforms.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={review.src} width={review.width} height={review.height} alt="" loading="lazy" decoding="async"
              onError={() => setFailed(items => items.includes(review.src) ? items : [...items, review.src])} />}
        </button>)}
      </div> : null}
    </div>
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
.landing-stories-heading { display: flex; align-items: end; justify-content: space-between; gap: 12px; margin-bottom: 16px; }
.landing-stories-heading p { margin: 0 0 7px; font-size: 12px; color: #777780; }
.landing-stories-heading h1 { margin: 0; font-size: clamp(23px, 3vw, 30px); font-weight: 750; letter-spacing: -.045em; line-height: 1.3; }
.landing-stories-swipe { display: none; }
.landing-stories-cards { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
.landing-stories .landing-stories-card { display: flex; flex-direction: column; justify-content: space-between; gap: 22px; min-width: 0; min-height: 170px; padding: 22px 20px 16px; border: 1px solid #e7e5e7; border-radius: 16px; background: #fff; color: #202024; text-align: left; cursor: pointer; box-shadow: none; }
.landing-stories .landing-stories-card:first-child { background: #fff8fa; border-color: #f2dce4; }
.landing-stories-quote { display: block; font-size: 18px; font-weight: 650; line-height: 1.65; letter-spacing: -.025em; word-break: keep-all; overflow-wrap: anywhere; }
.landing-stories-card-foot { display: flex; align-items: center; justify-content: space-between; gap: 8px; font-size: 11px; color: #86838a; }
.landing-stories-card-foot > span:last-child { color: #5d5961; white-space: nowrap; }
.landing-stories button:focus-visible { outline: 2px solid #ed174c; outline-offset: -3px; }
.landing-stories-meta { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-top: 8px; color: #89848b; font-size: 11px; }
.landing-stories-meta > span { line-height: 1.5; }
.landing-stories .landing-stories-meta button { flex-shrink: 0; min-height: 44px; padding: 8px 0 8px 12px; border: 0; background: transparent; color: #625c65; font-size: 12px; font-weight: 500; cursor: pointer; }
.landing-stories-gallery { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; padding-top: 10px; }
.landing-stories-gallery button { min-width: 0; height: 150px; padding: 6px; border: 1px solid #e7e5e7; border-radius: 10px; background: #fafafa; color: #625c65; cursor: zoom-in; }
.landing-stories-gallery img { width: 100%; height: 100%; object-fit: contain; }
.landing-stories-dialog { position: fixed; inset: 0; margin: auto; width: calc(100% - 32px); max-width: 720px; max-height: 85dvh; padding: 16px; border: 1px solid #e7e5e7; border-radius: 18px; background: #fff; color: #202024; overflow: auto; }
.landing-stories-dialog::backdrop { background: rgb(0 0 0 / 60%); }
.landing-stories-dialog header { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 12px; }
.landing-stories-dialog h2 { margin: 0; font-size: 14px; font-weight: 650; }
.landing-stories-dialog header button { min-height: 44px; padding: 8px 12px; border: 1px solid #e7e5e7; border-radius: 10px; background: #fff; font-size: 13px; cursor: pointer; }
.landing-stories-dialog img { display: block; width: 100%; height: auto; object-fit: contain; }
.landing-stories-dialog p { margin: 12px 0 0; font-size: 11px; line-height: 1.6; color: #79727e; }
@media (max-width: 640px) {
  .landing-stories-heading { display: block; margin-bottom: 12px; }
  .landing-stories-swipe { display: block; margin-top: 9px; color: #89848b; font-size: 11px; }
  .landing-stories-cards { display: flex; overflow-x: auto; scroll-snap-type: x mandatory; scrollbar-width: thin; scrollbar-color: #ded8dc transparent; padding-bottom: 8px; }
  .landing-stories .landing-stories-card { flex: 0 0 85%; min-height: 165px; padding: 20px 18px 16px; scroll-snap-align: start; }
  .landing-stories-quote { font-size: 18px; }
  .landing-stories-meta { align-items: center; font-size: 10px; }
  .landing-stories-gallery { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .landing-stories-gallery button { height: 110px; }
}
`;
