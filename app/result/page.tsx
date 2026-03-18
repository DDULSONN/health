"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { RESULTS } from "@/lib/results";
import type { ResultId } from "@/lib/types";
import { getStoredAnswers, clearStoredAnswers } from "@/lib/storage";
import { calculateTotal, calculateTagScores, getResultId } from "@/lib/scoring";
import ResultCard from "@/components/ResultCard";
import ShareToCommBtn from "@/components/ShareToCommBtn";

const VALID_IDS: ResultId[] = [
  "heavy_ss",
  "senior",
  "routine",
  "talk",
  "pump",
  "frame",
  "egennam",
  "newbie",
  "manage",
  "reality",
];

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
      return;
    }

    const answers = getStoredAnswers();
    if (Object.keys(answers).length >= 20) {
      const id = getResultId(answers);
      setResultId(id);
      setTotalScore(calculateTotal(answers));
      setTagScores(calculateTagScores(answers));
      return;
    }

    setResultId("reality");
    setTotalScore(0);
    setTagScores(calculateTagScores({}));
  }, [searchParams]);

  const handleShare = useCallback(async () => {
    if (!resultId) return;
    const result = RESULTS[resultId];
    const shareUrl =
      typeof window !== "undefined" ? `${window.location.origin}/result?r=${resultId}` : "";

    const shareData = {
      title: "헬스 성향 테스트 결과",
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
      return;
    }

    try {
      await navigator.clipboard.writeText(`${result.shareText}\n${shareUrl}`);
      setShareStatus("copied");
      setTimeout(() => setShareStatus("idle"), 2000);
    } catch {
      setShareStatus("error");
    }
  }, [resultId]);

  const handleRetry = useCallback(() => {
    clearStoredAnswers();
    window.location.href = "/helltest";
  }, []);

  if (resultId === null) {
    return (
      <main className="mx-auto flex min-h-screen max-w-md items-center justify-center p-6">
        <p className="text-neutral-500">결과를 불러오는 중...</p>
      </main>
    );
  }

  const result = RESULTS[resultId];
  const tags =
    tagScores ?? {
      heavy: 0,
      routine: 0,
      talk: 0,
      pump: 0,
      manage: 0,
      newbie: 0,
      frame: 0,
      egennam: 0,
    };

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col p-4 pb-8">
      <ResultCard result={result} totalScore={totalScore} tagScores={tags} className="mb-6" />

      <div className="space-y-3">
        <button
          type="button"
          onClick={handleShare}
          className="w-full min-h-[56px] rounded-xl bg-emerald-600 font-medium text-white transition-all hover:bg-emerald-700 active:scale-[0.98]"
        >
          {shareStatus === "copied"
            ? "클립보드에 복사됨"
            : shareStatus === "shared"
            ? "공유 완료"
            : "결과 공유하기"}
        </button>
        <button
          type="button"
          onClick={handleRetry}
          className="w-full min-h-[56px] rounded-xl bg-neutral-200 font-medium text-neutral-800 transition-all hover:bg-neutral-300 active:scale-[0.98]"
        >
          다시하기
        </button>
        <ShareToCommBtn
          type="helltest"
          title={`헬스성향테스트 결과: ${result.title}`}
          payload={{ resultId, title: result.title, totalScore }}
        />
      </div>

      <div className="mt-6 space-y-2 border-t border-neutral-200 pt-4">
        <p className="mb-3 text-center text-sm text-neutral-500">다른 기능도 사용해보세요</p>
        <div className="grid grid-cols-1 gap-2">
          <Link
            href="/1rm"
            className="block rounded-xl bg-emerald-50 px-4 py-3 text-center text-sm font-medium text-emerald-700 transition-colors hover:bg-emerald-100"
          >
            🏋️ 1RM 계산기
          </Link>
          <Link
            href="/dating/1on1"
            className="block rounded-xl bg-blue-50 px-4 py-3 text-center text-sm font-medium text-blue-700 transition-colors hover:bg-blue-100"
          >
            🤝 1:1 오프라인 소개팅
          </Link>
          <Link
            href="/community?tab=photo_bodycheck"
            className="block rounded-xl bg-indigo-50 px-4 py-3 text-center text-sm font-medium text-indigo-700 transition-colors hover:bg-indigo-100"
          >
            📸 사진 몸평 게시판
          </Link>
        </div>
      </div>

      <Link href="/" className="mt-4 block text-center text-sm text-neutral-500 hover:text-neutral-700">
        홈으로
      </Link>
    </main>
  );
}

export default function ResultPage() {
  return (
    <Suspense
      fallback={
        <main className="mx-auto flex min-h-screen max-w-md items-center justify-center p-6">
          <p className="text-neutral-500">결과를 불러오는 중...</p>
        </main>
      }
    >
      <ResultContent />
    </Suspense>
  );
}
