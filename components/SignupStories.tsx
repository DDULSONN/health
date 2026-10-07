"use client";

import { useEffect, useId, useRef, useState } from "react";
import { SIGNUP_REVIEWS } from "@/lib/landing-reviews";

export default function SignupStories() {
  const titleId = useId();
  const dialogTitleId = useId();
  const section = useRef<HTMLElement>(null);
  const rail = useRef<HTMLDivElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const [ready, setReady] = useState(false);
  const [visible, setVisible] = useState(false);
  const [paused, setPaused] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);
  const [failed, setFailed] = useState<string[]>([]);

  useEffect(() => {
    const element = section.current;
    if (!element) return;
    if (!("IntersectionObserver" in window)) {
      let active = true;
      queueMicrotask(() => { if (active) { setReady(true); setVisible(true); } });
      return () => { active = false; };
    }
    const observer = new IntersectionObserver(([entry]) => {
      setVisible(entry.isIntersecting);
      if (entry.isIntersecting) setReady(true);
    }, { rootMargin: "100px 0px" });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(preference.matches);
    update();
    preference.addEventListener("change", update);
    return () => preference.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    if (selected === null) return;
    const element = dialog.current;
    if (!element) return;
    element.showModal();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      element.close();
      document.body.style.overflow = previousOverflow;
    };
  }, [selected]);

  const reviews = SIGNUP_REVIEWS.filter(review => !failed.includes(review.src));
  const current = selected === null ? null : SIGNUP_REVIEWS[selected];
  if (reviews.length === 0 && selected === null) return null;

  return (
    <section ref={section} aria-labelledby={titleId} className="signup-stories">
      <div className="signup-stories-heading">
        <h2 id={titleId}>짐툴에서 만난 이야기</h2>
        <button type="button" onClick={() => {
          // Manual scrolling and the looping transform must not add their offsets together.
          if (paused && rail.current) rail.current.scrollLeft = 0;
          setPaused(value => !value);
        }} disabled={reducedMotion}
          aria-label={reducedMotion ? "후기 직접 넘겨보기" : paused ? "후기 자동 이동 재생" : "후기 자동 이동 일시정지"}>
          {reducedMotion ? "직접 넘겨보기" : paused ? "재생" : "일시정지"}
        </button>
      </div>
      <div ref={rail} className="signup-stories-rail" data-ready={ready} onPointerDown={() => setPaused(true)}>
        {ready && <div className="signup-stories-track" data-paused={paused || !visible || selected !== null}>
          {[false, true].map(duplicate => (
            <div key={String(duplicate)} className="signup-stories-group" aria-hidden={duplicate || undefined}>
              {reviews.map(review => {
                const index = SIGNUP_REVIEWS.indexOf(review);
                return <button type="button" key={review.src} className="signup-stories-card" tabIndex={duplicate ? -1 : 0}
                  aria-label={`만남 후기 ${index + 1} 크게 보기`} onClick={() => {
                    if (typeof dialog.current?.showModal !== "function") {
                      window.open(review.src, "_blank", "noopener,noreferrer");
                      return;
                    }
                    setSelected(index);
                  }}>
                  {/* Already-small static WebP; no image-transform requests or additional originals. */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={review.src} width={review.width} height={review.height} alt="" loading="lazy" decoding="async" fetchPriority="low"
                    onError={() => setFailed(value => value.includes(review.src) ? value : [...value, review.src])} />
                </button>;
              })}
            </div>
          ))}
        </div>}
      </div>
      <p className="signup-stories-hint">눌러서 크게 보기</p>
      <dialog ref={dialog} className="signup-stories-dialog" aria-labelledby={dialogTitleId}
        onCancel={event => { event.preventDefault(); setSelected(null); }}
        onClose={() => setSelected(null)}
        onClick={event => { if (event.target === event.currentTarget) setSelected(null); }}>
        <div className="signup-stories-dialog-body">
          <div className="signup-stories-dialog-heading">
            <h2 id={dialogTitleId}>짐툴에서 만난 이야기</h2>
            <button type="button" onClick={() => setSelected(null)}>닫기</button>
          </div>
          {current && !failed.includes(current.src) ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={current.src} width={current.width} height={current.height} alt={`짐툴 회원의 만남 후기 ${selected! + 1}`} decoding="async"
              onError={() => setFailed(value => value.includes(current.src) ? value : [...value, current.src])} />
          ) : <p className="signup-stories-hint">후기를 불러오지 못했어요. 닫은 뒤 다시 확인해 주세요.</p>}
        </div>
      </dialog>
      <style>{STYLES}</style>
    </section>
  );
}

// Scoped selectors keep this small, static presentation independent of signup form styles.
const STYLES = `
.signup-stories { margin-top: 28px; border-top: 1px solid #e5e5e5; padding-top: 12px; color: #525252; }
.signup-stories-heading { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 6px; }
.signup-stories-heading h2 { margin: 0; font-size: 12px; font-weight: 600; }
.signup-stories-heading button { min-height: 32px; padding: 4px 0 4px 8px; font-size: 11px; color: #737373; background: transparent; cursor: pointer; }
.signup-stories-heading button:disabled { cursor: default; }
.signup-stories-rail { overflow-x: auto; scrollbar-width: none; height: 112px; border-radius: 10px; background: #f5f5f5; }
.signup-stories-rail::-webkit-scrollbar { display: none; }
.signup-stories-track { display: flex; width: max-content; animation: signup-stories-drift 48s linear infinite; }
.signup-stories-track[data-paused="true"], .signup-stories-track:focus-within { animation-play-state: paused; }
.signup-stories-track:has(:focus-visible) { animation: none; }
.signup-stories-group { display: flex; flex: 0 0 auto; gap: 10px; padding-right: 10px; }
.signup-stories-card { display: flex; align-items: center; justify-content: center; width: 236px; height: 112px; flex: 0 0 auto; overflow: hidden; border: 1px solid #e5e5e5; border-radius: 10px; padding: 4px; background: #171717; cursor: zoom-in; }
.signup-stories-card img { width: 100%; height: 100%; object-fit: contain; }
.signup-stories-card:focus-visible { outline: 2px solid #e11d48; outline-offset: -3px; }
.signup-stories-hint { margin: 6px 0 0; font-size: 10px; color: #737373; }
.signup-stories-dialog { position: fixed; inset: 0; margin: auto; padding: 0; width: calc(100% - 32px); max-width: 640px; max-height: 85dvh; overflow: auto; border: 1px solid #e5e5e5; border-radius: 16px; background: #fff; color: #171717; }
.signup-stories-dialog::backdrop { background: rgb(0 0 0 / 60%); }
.signup-stories-dialog-body { padding: 12px; }
.signup-stories-dialog-heading { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 8px; }
.signup-stories-dialog-heading h2 { margin: 0; font-size: 13px; font-weight: 600; }
.signup-stories-dialog-heading button { min-height: 44px; padding: 8px 12px; border-radius: 8px; font-size: 13px; cursor: pointer; }
.signup-stories-dialog img { display: block; width: 100%; height: auto; max-height: 68dvh; object-fit: contain; background: #171717; border-radius: 8px; }
@keyframes signup-stories-drift { to { transform: translateX(-50%); } }
@media (hover: hover) and (pointer: fine) { .signup-stories-rail:hover .signup-stories-track { animation-play-state: paused; } }
@media (prefers-reduced-motion: reduce) { .signup-stories-track { animation: none; } .signup-stories-group[aria-hidden="true"] { display: none; } }
`;
