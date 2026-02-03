"use client";

/**
 * 질문 카드: 문항 텍스트 표시 (2~3줄 가독)
 */

interface QuestionCardProps {
  questionNumber: number;
  text: string;
  className?: string;
}

export default function QuestionCard({ questionNumber, text, className = "" }: QuestionCardProps) {
  return (
    <div className={`rounded-2xl bg-white border border-neutral-200 shadow-sm p-6 ${className}`}>
      <span className="text-xs font-medium text-emerald-600 uppercase tracking-wide">
        Q{questionNumber}
      </span>
      <p className="mt-2 text-lg leading-relaxed text-neutral-800 font-medium">
        {text}
      </p>
    </div>
  );
}
