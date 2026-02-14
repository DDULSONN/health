"use client";

import { useRef, useState } from "react";
import type { ResultContent } from "@/lib/results";
import type { TagId, TagScores } from "@/lib/types";
import { TAG_LABELS, getTopTags } from "@/lib/scoring";

interface ResultCardProps {
  result: ResultContent;
  totalScore: number;
  tagScores: TagScores;
  className?: string;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function isMobileDevice(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
}

function isCorsLikeError(message: string): boolean {
  return /tainted|cross-origin|cors|insecure/i.test(message);
}

function sanitizeFileName(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, "_").trim();
}

async function waitForFontsReady(): Promise<void> {
  if (typeof document === "undefined" || !("fonts" in document)) return;
  await document.fonts.ready;
}

async function waitForImagesReady(element: HTMLElement): Promise<{ externalImageUrls: string[] }> {
  const images = Array.from(element.querySelectorAll("img"));
  const externalImageUrls = new Set<string>();

  const tasks = images.map(
    (img) =>
      new Promise<void>((resolve) => {
        try {
          const src = img.currentSrc || img.src;
          if (
            src &&
            !src.startsWith("data:") &&
            !src.startsWith("blob:") &&
            !img.crossOrigin
          ) {
            img.crossOrigin = "anonymous";
          }

          if (src && /^https?:\/\//i.test(src)) {
            const srcOrigin = new URL(src, window.location.origin).origin;
            if (srcOrigin !== window.location.origin) {
              externalImageUrls.add(src);
            }
          }
        } catch {
          // ignore URL parsing/crossOrigin assignment errors
        }

        if (img.complete && img.naturalWidth > 0) {
          resolve();
          return;
        }

        const done = () => {
          cleanup();
          resolve();
        };

        const cleanup = () => {
          img.removeEventListener("load", done);
          img.removeEventListener("error", done);
          clearTimeout(timeoutId);
        };

        const timeoutId = window.setTimeout(done, 5000);
        img.addEventListener("load", done, { once: true });
        img.addEventListener("error", done, { once: true });
      }),
  );

  await Promise.all(tasks);
  return { externalImageUrls: Array.from(externalImageUrls) };
}

async function captureWithHtmlToImage(element: HTMLElement): Promise<string> {
  const { toPng } = await import("html-to-image");
  return toPng(element, {
    cacheBust: true,
    pixelRatio: Math.max(2, window.devicePixelRatio || 1),
    backgroundColor: "#ffffff",
    style: {
      backgroundColor: "#ffffff",
    },
  });
}

async function captureWithHtml2Canvas(element: HTMLElement): Promise<string> {
  const html2canvas = (await import("html2canvas")).default;

  const canvas = await html2canvas(element, {
    scale: Math.max(2, window.devicePixelRatio || 1),
    backgroundColor: "#ffffff",
    useCORS: true,
    allowTaint: false,
    logging: false,
    imageTimeout: 15000,
  });

  return canvas.toDataURL("image/png");
}

async function captureWithFallback(element: HTMLElement): Promise<{ dataUrl: string; method: string }> {
  try {
    const dataUrl = await captureWithHtmlToImage(element);
    return { dataUrl, method: "html-to-image" };
  } catch (error) {
    const message = getErrorMessage(error);
    console.error(`[ResultCard] html-to-image capture failed: ${message}`, error);
  }

  try {
    const dataUrl = await captureWithHtml2Canvas(element);
    return { dataUrl, method: "html2canvas" };
  } catch (error) {
    const message = getErrorMessage(error);
    console.error(`[ResultCard] html2canvas capture failed: ${message}`, error);
    throw new Error(`capture fallback failed: ${message}`);
  }
}

function triggerDesktopDownload(dataUrl: string, fileName: string): void {
  const link = document.createElement("a");
  link.download = fileName;
  link.href = dataUrl;
  link.rel = "noopener";
  link.click();
}

async function dataUrlToFile(dataUrl: string, fileName: string): Promise<File> {
  const response = await fetch(dataUrl);
  const blob = await response.blob();
  return new File([blob], fileName, { type: "image/png" });
}

async function tryShareOnMobile(dataUrl: string, fileName: string): Promise<boolean> {
  if (typeof navigator === "undefined" || !navigator.share) return false;

  try {
    const file = await dataUrlToFile(dataUrl, fileName);
    const shareData: ShareData = {
      title: "헬스 성향 테스트 결과",
      text: "내 헬스 성향 테스트 결과 이미지",
      files: [file],
    };

    if (navigator.canShare && !navigator.canShare(shareData)) {
      return false;
    }

    await navigator.share(shareData);
    return true;
  } catch (error) {
    const message = getErrorMessage(error);
    if (!(error instanceof Error && error.name === "AbortError")) {
      console.error(`[ResultCard] mobile share failed: ${message}`, error);
    }
    return false;
  }
}

function openImageInNewTab(dataUrl: string, popup: Window | null): boolean {
  if (popup && !popup.closed) {
    popup.document.title = "결과 이미지";
    popup.document.body.style.margin = "0";
    popup.document.body.style.background = "#111";
    popup.document.body.innerHTML =
      '<img src="' +
      dataUrl +
      '" alt="결과 이미지" style="display:block;max-width:100vw;max-height:100vh;margin:0 auto;" />';
    return true;
  }

  const win = window.open(dataUrl, "_blank", "noopener,noreferrer");
  return Boolean(win);
}

function buildFailureMessage(errorMessage: string, externalImageUrls: string[]): string {
  if (isCorsLikeError(errorMessage)) {
    if (externalImageUrls.length > 0) {
      return `외부 이미지 CORS 제한으로 캡처에 실패했습니다. 외부 리소스: ${externalImageUrls[0]}`;
    }
    return "CORS/tainted canvas 이슈로 캡처에 실패했습니다. 캡처 영역의 외부 리소스 설정을 확인하세요.";
  }

  return errorMessage;
}

export default function ResultCard({
  result,
  totalScore,
  tagScores,
  className = "",
}: ResultCardProps) {
  const topTags = getTopTags(tagScores);
  const cardRef = useRef<HTMLDivElement>(null);
  const [isDownloading, setIsDownloading] = useState(false);
  const [feedback, setFeedback] = useState("");

  const handleDownloadImage = async () => {
    const element = cardRef.current;
    if (!element) return;

    const mobile = isMobileDevice();
    const popupWindow = mobile ? window.open("", "_blank") : null;

    setIsDownloading(true);
    setFeedback("");

    try {
      await waitForFontsReady();
      await waitForImagesReady(element);

      const { dataUrl, method } = await captureWithFallback(element);
      const fileName = sanitizeFileName(`헬스성향테스트_${result.title}.png`);

      if (mobile) {
        const shared = await tryShareOnMobile(dataUrl, fileName);
        if (shared) {
          if (popupWindow && !popupWindow.closed) {
            popupWindow.close();
          }
          setFeedback("이미지 공유가 완료되었습니다.");
          setTimeout(() => setFeedback(""), 2500);
          return;
        }

        const opened = openImageInNewTab(dataUrl, popupWindow);
        if (!opened) {
          throw new Error("모바일 새 탭 열기에 실패했습니다. 팝업 차단을 해제해 주세요.");
        }

        console.info(`[ResultCard] image exported by ${method} on mobile`);
        setFeedback("새 탭에서 이미지를 길게 눌러 저장하세요.");
        setTimeout(() => setFeedback(""), 3500);
        return;
      }

      triggerDesktopDownload(dataUrl, fileName);
      console.info(`[ResultCard] image exported by ${method} on desktop`);
      setFeedback("이미지가 저장되었습니다.");
      setTimeout(() => setFeedback(""), 2000);
    } catch (error) {
      const rawMessage = getErrorMessage(error);
      const { externalImageUrls } = await waitForImagesReady(element).catch(() => ({ externalImageUrls: [] }));
      const failureReason = buildFailureMessage(rawMessage, externalImageUrls);

      console.error(`[ResultCard] image save failed: ${rawMessage}`, error);
      if (popupWindow && !popupWindow.closed) {
        popupWindow.close();
      }
      setFeedback(`이미지 저장 실패: ${failureReason}`);
    } finally {
      setIsDownloading(false);
    }
  };

  return (
    <div
      ref={cardRef}
      className={`rounded-2xl bg-white border border-neutral-200 shadow-md overflow-hidden ${className}`}
    >
      <div className="p-6 pb-4 text-center bg-gradient-to-b from-emerald-50 to-white">
        <span className="text-4xl block mb-2" aria-hidden>
          {result.emoji}
        </span>
        <h1 className="text-xl font-bold text-neutral-900">{result.title}</h1>
        <p className="mt-1 text-neutral-600 text-sm">{result.subtitle}</p>
      </div>

      <div className="px-6 py-4 border-t border-neutral-100">
        <h2 className="text-sm font-semibold text-neutral-700 mb-2">핵심 특징</h2>
        <ul className="space-y-1.5">
          {result.traits.map((t, i) => (
            <li key={i} className="flex gap-2 text-sm text-neutral-700">
              <span className="text-emerald-500 shrink-0">•</span>
              <span>{t}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="px-6 py-4 bg-neutral-50 border-t border-neutral-100">
        <h2 className="text-sm font-semibold text-neutral-700 mb-2">점수와 성향 요약</h2>
        <p className="text-sm text-neutral-600 mb-2">
          총점 <strong>{totalScore}</strong>점 (60점 만점)
        </p>
        {topTags.length > 0 && (
          <p className="text-sm text-neutral-600">
            상위 태그:{" "}
            {topTags.map(({ tag, score }) => (
              <span key={tag} className="inline-block mr-2">
                <strong>{TAG_LABELS[tag as TagId]}</strong>({score})
              </span>
            ))}
          </p>
        )}
      </div>

      <div className="px-6 py-4 border-t border-neutral-100">
        <button
          onClick={handleDownloadImage}
          disabled={isDownloading}
          className="w-full min-h-[48px] rounded-xl bg-blue-600 text-white font-medium hover:bg-blue-700 active:scale-[0.98] transition-all disabled:opacity-50"
        >
          {isDownloading ? "이미지 생성 중..." : "결과 이미지 저장"}
        </button>
        {feedback && <p className="text-xs text-center text-neutral-600 mt-2 break-words">{feedback}</p>}
      </div>

      <div className="px-6 py-3 border-t border-neutral-100">
        <p className="text-xs text-neutral-500 break-words">공유 문구: {result.shareText}</p>
      </div>
    </div>
  );
}
