"use client";

/**
 * 결과 카드: 제목/한줄/특징/공유문구
 * + "왜 이 결과가 나왔는지" (total, 상위 태그 2개)
 */

import { useRef, useState } from "react";
import type { ResultContent } from "@/lib/results";
import type { TagScores } from "@/lib/types";
import { TAG_LABELS } from "@/lib/scoring";
import { getTopTags } from "@/lib/scoring";
import type { TagId } from "@/lib/types";

interface ResultCardProps {
  result: ResultContent;
  totalScore: number;
  tagScores: TagScores;
  className?: string;
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

    setIsDownloading(true);
    setFeedback("");

    try {
      // 폰트 로딩 대기
      await document.fonts.ready;

      // html2canvas를 동적으로 import (클라이언트 전용)
      const html2canvas = (await import('html2canvas')).default;

      const canvas = await html2canvas(element, {
        scale: 2, // Retina 디스플레이 대응
        backgroundColor: '#ffffff',
        useCORS: true,
        logging: false,
      });

      const link = document.createElement('a');
      link.download = `헬창판록기_${result.title}.png`;
      link.href = canvas.toDataURL('image/png');
      link.click();

      setFeedback("이미지가 저장되었습니다");
      setTimeout(() => setFeedback(""), 2000);
    } catch (error) {
      console.error('Image download failed:', error);
      setFeedback("이미지 저장에 실패했습니다");
      setTimeout(() => setFeedback(""), 2000);
    } finally {
      setIsDownloading(false);
    }
  };

  return (
    <div ref={cardRef} className={`rounded-2xl bg-white border border-neutral-200 shadow-md overflow-hidden ${className}`}>
      {/* 상단 이모지 + 제목 */}
      <div className="p-6 pb-4 text-center bg-gradient-to-b from-emerald-50 to-white">
        <span className="text-4xl block mb-2" aria-hidden>{result.emoji}</span>
        <h1 className="text-xl font-bold text-neutral-900">{result.title}</h1>
        <p className="mt-1 text-neutral-600 text-sm">{result.subtitle}</p>
      </div>

      {/* 특징 5개 */}
      <div className="px-6 py-4 border-t border-neutral-100">
        <h2 className="text-sm font-semibold text-neutral-700 mb-2">특징</h2>
        <ul className="space-y-1.5">
          {result.traits.map((t, i) => (
            <li key={i} className="flex gap-2 text-sm text-neutral-700">
              <span className="text-emerald-500 shrink-0">•</span>
              <span>{t}</span>
            </li>
          ))}
        </ul>
      </div>

      {/* 왜 이 결과가 나왔는지 */}
      <div className="px-6 py-4 bg-neutral-50 border-t border-neutral-100">
        <h2 className="text-sm font-semibold text-neutral-700 mb-2">왜 이 결과가 나왔는지</h2>
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

      {/* 이미지로 저장 버튼 */}
      <div className="px-6 py-4 border-t border-neutral-100">
        <button
          onClick={handleDownloadImage}
          disabled={isDownloading}
          className="w-full min-h-[48px] rounded-xl bg-blue-600 text-white font-medium hover:bg-blue-700 active:scale-[0.98] transition-all disabled:opacity-50"
        >
          {isDownloading ? "이미지 생성 중..." : "📷 이미지로 저장"}
        </button>
        {feedback && (
          <p className="text-xs text-center text-neutral-600 mt-2">{feedback}</p>
        )}
      </div>

      {/* 공유 문구 (복사용) */}
      <div className="px-6 py-3 border-t border-neutral-100">
        <p className="text-xs text-neutral-500 break-words">공유 문구: {result.shareText}</p>
      </div>
    </div>
  );
}
