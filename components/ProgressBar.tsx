"use client";

/**
 * 상단 진행바: 20문항 중 현재 위치
 */

interface ProgressBarProps {
  current: number; // 1~20
  total: number;
  className?: string;
}

export default function ProgressBar({ current, total, className = "" }: ProgressBarProps) {
  const percent = total > 0 ? Math.min(100, (current / total) * 100) : 0;
  return (
    <div className={`w-full ${className}`} role="progressbar" aria-valuenow={current} aria-valuemin={1} aria-valuemax={total}>
      <div className="h-2 w-full rounded-full bg-neutral-200 overflow-hidden">
        <div
          className="h-full rounded-full bg-emerald-500 transition-all duration-300 ease-out"
          style={{ width: `${percent}%` }}
        />
      </div>
      <p className="mt-1.5 text-sm text-neutral-500 text-center">
        {current} / {total}
      </p>
    </div>
  );
}
