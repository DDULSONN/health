"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import ProgressBar from "@/components/ProgressBar";
import {
  BODYCHECK_QUESTIONS,
  TOTAL_BODYCHECK_QUESTIONS,
  calculateBodyCheckResult,
} from "@/lib/bodycheck";

export default function BodyCheckPage() {
  const router = useRouter();
  const [answers, setAnswers] = useState<Record<number, number>>({});
  const [currentIndex, setCurrentIndex] = useState(0);

  const question = BODYCHECK_QUESTIONS[currentIndex];
  const questionNumber = currentIndex + 1;
  const selectedOption = answers[question.id] ?? null;

  const handleSelect = useCallback(
    (optionIndex: number) => {
      const next = { ...answers, [question.id]: optionIndex };
      setAnswers(next);

      if (currentIndex >= TOTAL_BODYCHECK_QUESTIONS - 1) {
        // 마지막 문항 → 결과 계산
        const result = calculateBodyCheckResult(next);
        router.push(`/bodycheck/result?type=${result}`);
      } else {
        setCurrentIndex((i) => i + 1);
      }
    },
    [answers, question.id, currentIndex, router]
  );

  const goPrev = () => {
    if (currentIndex > 0) setCurrentIndex((i) => i - 1);
  };

  return (
    <main className="max-w-md mx-auto px-4 py-8">
      <div className="flex justify-between items-center mb-4">
        <h1 className="text-lg font-bold text-neutral-900">몸평가</h1>
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

      <ProgressBar
        current={questionNumber}
        total={TOTAL_BODYCHECK_QUESTIONS}
        className="mb-6"
      />

      {/* 질문 카드 */}
      <div className="rounded-2xl bg-white border border-neutral-200 shadow-sm p-6 mb-6">
        <span className="text-xs font-medium text-purple-600 uppercase tracking-wide">
          Q{questionNumber}
        </span>
        <p className="mt-2 text-lg leading-relaxed text-neutral-800 font-medium">
          {question.text}
        </p>
      </div>

      {/* 선택지 */}
      <div className="grid grid-cols-1 gap-3">
        {question.options.map((option, idx) => (
          <button
            key={idx}
            type="button"
            onClick={() => handleSelect(idx)}
            className={`min-h-[56px] px-4 py-3 rounded-xl font-medium text-base transition-all duration-150 active:scale-[0.98] ${
              selectedOption === idx
                ? "bg-purple-600 text-white ring-2 ring-purple-400 ring-offset-2"
                : "bg-neutral-100 text-neutral-800 hover:bg-neutral-200 border border-neutral-200"
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>
    </main>
  );
}
