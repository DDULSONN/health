"use client";
/* eslint-disable @next/next/no-html-link-for-pages -- Recovery must also work when the router/root layout failed. */

import { useEffect, useRef, useState } from "react";
import { getErrorRecoveryContext, getSafeErrorDigest, recoverySupportText } from "@/lib/error-recovery";

export default function ErrorRecovery({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const [path, setPath] = useState("");
  const [reference, setReference] = useState("");
  const [time, setTime] = useState("");
  const [copied, setCopied] = useState(false);
  const [showCopy, setShowCopy] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const retryLock = useRef(false);
  useEffect(() => {
    // Read browser-only context after hydration; SSR starts with conservative actions.
    const frame = window.requestAnimationFrame(() => {
      setPath(window.location.pathname);
      const now = new Date();
      const digest = getSafeErrorDigest(error);
      setReference(digest ? "GT-" + digest : "GT-" + now.getTime().toString(36).toUpperCase());
      setTime(now.toLocaleString("ko-KR", { timeZone: "Asia/Seoul" }));
      setRetrying(false); retryLock.current = false;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [error]);
  const context = getErrorRecoveryContext(path);
  useEffect(() => {
    if (!retrying) return;
    // A repeated render failure may carry the same Error object. Do not leave the button locked.
    const timer = window.setTimeout(() => { retryLock.current = false; setRetrying(false); }, 1500);
    return () => window.clearTimeout(timer);
  }, [retrying]);
  const text = recoverySupportText(reference, context.area, time);
  const button = { display: "inline-flex", alignItems: "center", justifyContent: "center", minHeight: 44,
    borderRadius: 12, padding: "10px 16px", fontSize: 14, fontWeight: 600, textDecoration: "none",
    border: "1px solid #dedede", background: "#fff", color: "#262626", cursor: "pointer" } as const;
  return <main style={{ width: "100%", maxWidth: 520, margin: "48px auto", padding: "0 20px", boxSizing: "border-box",
    color: "#171717", fontFamily: "Arial, 'Apple SD Gothic Neo', 'Malgun Gothic', sans-serif", lineHeight: 1.65 }}>
    <section aria-labelledby="recovery-title" style={{ border: "1px solid #e5e5e5", borderRadius: 24, padding: 24, background: "#fff" }}>
      <p style={{ margin: "0 0 12px", color: "#ef003b", fontSize: 13, fontWeight: 700 }}>짐툴</p>
      <h1 id="recovery-title" style={{ margin: 0, fontSize: 23, lineHeight: 1.4, letterSpacing: "-0.04em" }}>화면을 불러오지 못했어요</h1>
      <p role="alert" style={{ margin: "14px 0 20px", color: "#666", fontSize: 14, wordBreak: "keep-all", overflowWrap: "anywhere" }}>{context.description}</p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {context.canRetry && <button type="button" disabled={retrying} style={{ ...button, background: "#171717", color: "#fff", opacity: retrying ? 0.5 : 1 }}
          onClick={() => {
            if (retryLock.current) return;
            retryLock.current = true; setRetrying(true);
            try { reset(); } catch { retryLock.current = false; setRetrying(false); }
          }}>{retrying ? "불러오는 중…" : "화면 다시 불러오기"}</button>}
        {context.reviewHref && <a href={context.reviewHref} style={button}>{context.reviewLabel}</a>}
        <a href="/" style={button}>홈으로</a>
      </div>
      <div style={{ marginTop: 24, paddingTop: 18, borderTop: "1px solid #eee" }}>
        <p style={{ margin: "0 0 8px", fontSize: 12, color: "#737373", overflowWrap: "anywhere" }}>문의 코드: {reference || "확인 중"}</p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          <button type="button" disabled={!reference} style={button} onClick={() => {
            void (async () => {
              try { await navigator.clipboard.writeText(text); setCopied(true); }
              catch { setShowCopy(true); }
            })();
          }}>문의 내용 복사</button>
          <a style={button} href={"mailto:gymtools.kr@gmail.com?subject=" + encodeURIComponent("짐툴 화면 오류 문의") + "&body=" + encodeURIComponent(text)}>이메일 문의</a>
        </div>
        <p aria-live="polite" style={{ fontSize: 12, color: "#666", margin: "8px 0 0" }}>{copied ? "복사했어요. 문의할 때 붙여 넣어 주세요." : "계속되면 발생 상황과 함께 문의해 주세요."}</p>
        {showCopy && <textarea aria-label="복사할 문의 내용" readOnly value={text} onFocus={(event) => event.target.select()}
          style={{ width: "100%", boxSizing: "border-box", minHeight: 180, marginTop: 10, padding: 10, fontSize: 12, border: "1px solid #ddd", borderRadius: 8 }} />}
      </div>
    </section>
  </main>;
}
