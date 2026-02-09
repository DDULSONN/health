"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { QUESTIONS, TOTAL_QUESTIONS } from "@/lib/questions";
import type { AnswerValue } from "@/lib/questions";
import type { AnswersMap } from "@/lib/types";
import { getStoredAnswers, setStoredAnswers } from "@/lib/storage";
import { getResultId } from "@/lib/scoring";
import ProgressBar from "@/components/ProgressBar";
import QuestionCard from "@/components/QuestionCard";
import AnswerButtons from "@/components/AnswerButtons";

/**
 * 테스트 페이지: 1문항씩, 진행바, 답변 저장, 마지막에 결과 계산 후 /result 이동
 */

export default function TestPage() {
  const router = useRouter();
  const [answers, setAnswers] = useState<AnswersMap>({});
  const [currentIndex, setCurrentIndex] = useState(0); // 0~19
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setAnswers(getStoredAnswers());
    setMounted(true);
  }, []);

  const currentQuestion = QUESTIONS[currentIndex];
  const questionNumber = currentIndex + 1;
  const currentAnswer = answers[questionNumber] ?? null;

  const goNext = () => {
    if (currentIndex >= TOTAL_QUESTIONS - 1) {
      // 마지막 문항 답했으면 결과 계산 후 이동
      const resultId = getResultId(answers);
      router.push(`/result?r=${resultId}`);
      return;
    }
    setCurrentIndex((i) => i + 1);
  };

  const goPrev = () => {
    if (currentIndex > 0) setCurrentIndex((i) => i - 1);
  };

  const handleSelect = (value: AnswerValue) => {
    const next: AnswersMap = { ...answers, [questionNumber]: value };
    setAnswers(next);
    setStoredAnswers(next);
    if (currentIndex >= TOTAL_QUESTIONS - 1) {
      const resultId = getResultId(next);
      router.push(`/result?r=${resultId}`);
    } else {
      setCurrentIndex((i) => i + 1);
    }
  };

  if (!mounted || !currentQuestion) {
    return (
      <main className="min-h-screen flex items-center justify-center p-6 max-w-md mx-auto">
        <p className="text-neutral-500">로딩 중...</p>
      </main>
    );
  }

  return (
    <main className="min-h-screen flex flex-col p-4 pb-8 max-w-md mx-auto">
      {/* 뒤로가기 */}
      <div className="flex justify-between items-center mb-4">
        <Link
          href="/helltest"
          className="text-sm text-neutral-500 hover:text-neutral-700"
        >
          ← 돌아가기
        </Link>
        {currentIndex > 0 && (
          <button
            type="button"
            onClick={goPrev}
            className="text-sm text-emerald-600 hover:underline"
          >
            이전 문항
          </button>
        )}
      </div>

      <ProgressBar current={questionNumber} total={TOTAL_QUESTIONS} className="mb-6" />

      <QuestionCard
        questionNumber={questionNumber}
        text={currentQuestion.text}
        className="mb-6"
      />

      <AnswerButtons
        selected={currentAnswer}
        onSelect={handleSelect}
      />

      {currentAnswer && currentIndex < TOTAL_QUESTIONS - 1 && (
        <button
          type="button"
          onClick={goNext}
          className="mt-4 min-h-[48px] rounded-xl bg-neutral-200 text-neutral-700 font-medium hover:bg-neutral-300 active:scale-[0.98] transition-all"
        >
          다음 문항
        </button>
      )}
    </main>
  );
}
