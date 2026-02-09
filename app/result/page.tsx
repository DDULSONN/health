"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { RESULTS } from "@/lib/results";
import type { ResultId } from "@/lib/types";
import { getStoredAnswers, clearStoredAnswers } from "@/lib/storage";
import { calculateTotal, calculateTagScores, getResultId } from "@/lib/scoring";
import ResultCard from "@/components/ResultCard";

const VALID_IDS: ResultId[] = [
  "heavy_ss", "senior", "routine", "talk", "pump",
  "frame", "egennam", "newbie", "manage", "reality",
];

/**
 * 결과 페이지: 쿼리 r=결과ID 또는 저장된 답변으로 결과 표시
 * 공유(Web Share / 클립보드), 다시하기
 */
function ResultContent() {
  const searchParams = useSearchParams();
  const [resultId, setResultId] = useState<ResultId | null>(null);
  const [totalScore, setTotalScore] = useState(0);
  const [tagScores, setTagScores] = useState<ReturnType<typeof calculateTagScores> | null>(null);
  const [shareStatus, setShareStatus] = useState<"idle" | "copied" | "shared" | "error">("idle");

  useEffect(() => {
    const r = searchParams.get("r") as ResultId | null;
    if (r && VALID_IDS.includes(r)) {
      setResultId(r);
      const answers = getStoredAnswers();
      setTotalScore(calculateTotal(answers));
      setTagScores(calculateTagScores(answers));
    } else {
      // 쿼리 없으면 저장된 답변으로 계산
      const answers = getStoredAnswers();
      if (Object.keys(answers).length >= 20) {
        const id = getResultId(answers);
        setResultId(id);
        setTotalScore(calculateTotal(answers));
        setTagScores(calculateTagScores(answers));
      } else {
        setResultId("reality");
        setTotalScore(0);
        setTagScores(calculateTagScores({}));
      }
    }
  }, [searchParams]);

  const handleShare = useCallback(async () => {
    if (!resultId) return;
    const result = RESULTS[resultId];

    // 공유 URL 생성
    const shareUrl = typeof window !== 'undefined'
      ? `${window.location.origin}/result?r=${resultId}`
      : '';

    const shareData = {
      title: "헬창 판록기",
      text: result.shareText,
      url: shareUrl,
    };
    if (typeof navigator !== "undefined" && navigator.share) {
      try {
        await navigator.share(shareData);
        setShareStatus("shared");
      } catch (e) {
        if ((e as Error).name !== "AbortError") {
          setShareStatus("error");
        }
      }
    } else {
      try {
        // URL 포함하여 클립보드에 복사
        await navigator.clipboard.writeText(`${result.shareText}\n${shareUrl}`);
        setShareStatus("copied");
        setTimeout(() => setShareStatus("idle"), 2000);
      } catch {
        setShareStatus("error");
      }
    }
  }, [resultId]);

  const handleRetry = useCallback(() => {
    clearStoredAnswers();
    window.location.href = "/helltest";
  }, []);

  if (resultId === null) {
    return (
      <main className="min-h-screen flex items-center justify-center p-6 max-w-md mx-auto">
        <p className="text-neutral-500">결과를 불러오는 중...</p>
      </main>
    );
  }

  const result = RESULTS[resultId];
  const tags = tagScores ?? {
    heavy: 0, routine: 0, talk: 0, pump: 0,
    manage: 0, newbie: 0, frame: 0, egennam: 0,
  };

  return (
    <main className="min-h-screen flex flex-col p-4 pb-8 max-w-md mx-auto">
      <ResultCard result={result} totalScore={totalScore} tagScores={tags} className="mb-6" />

      <div className="space-y-3">
        <button
          type="button"
          onClick={handleShare}
          className="w-full min-h-[56px] rounded-xl bg-emerald-600 text-white font-medium hover:bg-emerald-700 active:scale-[0.98] transition-all"
        >
          {shareStatus === "copied"
            ? "클립보드에 복사됨"
            : shareStatus === "shared"
              ? "공유 완료"
              : "내 결과 공유하기"}
        </button>
        <button
          type="button"
          onClick={handleRetry}
          className="w-full min-h-[56px] rounded-xl bg-neutral-200 text-neutral-800 font-medium hover:bg-neutral-300 active:scale-[0.98] transition-all"
        >
          다시하기
        </button>
      </div>

      {/* CTA */}
      <div className="mt-6 pt-4 border-t border-neutral-200 space-y-2">
        <p className="text-sm text-neutral-500 text-center mb-3">다른 도구도 사용해 보세요</p>
        <div className="grid grid-cols-1 gap-2">
          <Link
            href="/1rm"
            className="block text-center py-3 px-4 rounded-xl bg-emerald-50 text-emerald-700 font-medium text-sm hover:bg-emerald-100 transition-colors"
          >
            🏋️ 1RM 계산해보기
          </Link>
          <Link
            href="/snacks"
            className="block text-center py-3 px-4 rounded-xl bg-blue-50 text-blue-700 font-medium text-sm hover:bg-blue-100 transition-colors"
          >
            🍫 다이어트 간식 보기
          </Link>
          <Link
            href="/bodycheck"
            className="block text-center py-3 px-4 rounded-xl bg-purple-50 text-purple-700 font-medium text-sm hover:bg-purple-100 transition-colors"
          >
            📊 몸평가 하기
          </Link>
        </div>
      </div>

      <Link href="/" className="block text-center mt-4 text-sm text-neutral-500 hover:text-neutral-700">
        홈으로
      </Link>
    </main>
  );
}

export default function ResultPage() {
  return (
    <Suspense fallback={
      <main className="min-h-screen flex items-center justify-center p-6 max-w-md mx-auto">
        <p className="text-neutral-500">결과를 불러오는 중...</p>
      </main>
    }>
      <ResultContent />
    </Suspense>
  );
}
