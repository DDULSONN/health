"use client";

/**
 * 답변 버튼 3개: 그렇다 / 중간이다 / 아니다
 * 엄지 누르기 편한 높이(56px 이상), 터치 피드백
 */

import type { AnswerValue } from "@/lib/questions";
import { ANSWER_LABELS } from "@/lib/questions";

interface AnswerButtonsProps {
  onSelect: (value: AnswerValue) => void;
  selected: AnswerValue | null;
  disabled?: boolean;
  className?: string;
}

const OPTIONS: AnswerValue[] = [3, 2, 1]; // 그렇다, 중간이다, 아니다 순

export default function AnswerButtons({
  onSelect,
  selected,
  disabled = false,
  className = "",
}: AnswerButtonsProps) {
  return (
    <div className={`grid grid-cols-1 gap-3 ${className}`}>
      {OPTIONS.map((value) => (
        <button
          key={value}
          type="button"
          disabled={disabled}
          onClick={() => onSelect(value)}
          className={`
            min-h-[56px] px-4 py-3 rounded-xl font-medium text-base
            transition-all duration-150 active:scale-[0.98]
            disabled:opacity-50 disabled:pointer-events-none
            ${selected === value
              ? "bg-emerald-600 text-white ring-2 ring-emerald-400 ring-offset-2"
              : "bg-neutral-100 text-neutral-800 hover:bg-neutral-200 border border-neutral-200"
            }
          `}
        >
          {ANSWER_LABELS[value]}
        </button>
      ))}
    </div>
  );
}
