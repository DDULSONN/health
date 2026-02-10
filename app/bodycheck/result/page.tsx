"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import AdSlot from "@/components/AdSlot";
import ShareToCommBtn from "@/components/ShareToCommBtn";
import {
  BODYCHECK_RESULTS,
  type BodyCheckTypeId,
} from "@/lib/bodycheck";

const VALID_TYPES: BodyCheckTypeId[] = [
  "bulk_beginner",
  "cutting",
  "maintain",
  "growth",
  "fat_manage",
  "broken",
];

function BodyCheckResultContent() {
  const searchParams = useSearchParams();
  const typeParam = searchParams.get("type") as BodyCheckTypeId | null;
  const typeId = typeParam && VALID_TYPES.includes(typeParam) ? typeParam : "maintain";
  const result = BODYCHECK_RESULTS[typeId];

  const shareUrl =
    typeof window !== "undefined"
      ? `${window.location.origin}/bodycheck/result?type=${typeId}`
      : "";

  const handleShare = async () => {
    try {
      await navigator.clipboard.writeText(
        `몸평가 결과: ${result.title} ${result.emoji}\n${shareUrl}`
      );
      alert("링크가 복사되었습니다!");
    } catch { /* ignore */ }
  };

  return (
    <main className="max-w-md mx-auto px-4 py-8">
      {/* 결과 카드 */}
      <div className="rounded-2xl bg-white border border-neutral-200 shadow-md overflow-hidden mb-6">
        {/* 헤더 */}
        <div className="p-6 pb-4 text-center bg-gradient-to-b from-purple-50 to-white">
          <span className="text-4xl block mb-2" aria-hidden>
            {result.emoji}
          </span>
          <h1 className="text-xl font-bold text-neutral-900">{result.title}</h1>
          <p className="mt-1 text-neutral-600 text-sm">{result.subtitle}</p>
        </div>

        {/* 코멘트 */}
        <div className="px-6 py-4 border-t border-neutral-100">
          <p className="text-sm text-neutral-700 leading-relaxed">
            {result.comment}
          </p>
        </div>

        {/* 추천 액션 */}
        <div className="px-6 py-4 bg-neutral-50 border-t border-neutral-100">
          <h2 className="text-sm font-semibold text-neutral-700 mb-2">
            추천 액션
          </h2>
          <ul className="space-y-1.5">
            {result.tips.map((tip, i) => (
              <li key={i} className="flex gap-2 text-sm text-neutral-700">
                <span className="text-purple-500 shrink-0">•</span>
                <span>{tip}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* 액션 버튼 */}
      <div className="space-y-3">
        <button
          type="button"
          onClick={handleShare}
          className="w-full min-h-[56px] rounded-xl bg-purple-600 text-white font-medium hover:bg-purple-700 active:scale-[0.98] transition-all"
        >
          내 결과 공유하기
        </button>

        <Link
          href="/bodycheck"
          className="block text-center w-full min-h-[56px] leading-[56px] rounded-xl bg-neutral-200 text-neutral-800 font-medium hover:bg-neutral-300 transition-all"
        >
          다시하기
        </Link>
        <ShareToCommBtn
          type="bodycheck"
          title={`몸평가 결과: ${result.title} ${result.emoji}`}
          payload={{ typeId, title: result.title, subtitle: result.subtitle }}
        />
      </div>

      {/* CTA */}
      <div className="mt-6 pt-4 border-t border-neutral-200 space-y-2">
        <p className="text-sm text-neutral-500 text-center mb-3">
          다른 도구도 사용해 보세요
        </p>
        <div className="grid grid-cols-1 gap-2">
          <Link
            href="/1rm"
            className="block text-center py-3 px-4 rounded-xl bg-emerald-50 text-emerald-700 font-medium text-sm hover:bg-emerald-100 transition-colors"
          >
            🏋️ 1RM 계산하기
          </Link>
          <Link
            href="/snacks"
            className="block text-center py-3 px-4 rounded-xl bg-blue-50 text-blue-700 font-medium text-sm hover:bg-blue-100 transition-colors"
          >
            🍫 다이어트 간식 보기
          </Link>
        </div>
      </div>

      <AdSlot slotId="bodycheck-result" className="mt-6" />

      <Link
        href="/"
        className="block text-center mt-4 text-sm text-neutral-500 hover:text-neutral-700"
      >
        홈으로
      </Link>
    </main>
  );
}

export default function BodyCheckResultPage() {
  return (
    <Suspense
      fallback={
        <main className="max-w-md mx-auto px-4 py-10">
          <p className="text-neutral-400 text-center">결과를 불러오는 중...</p>
        </main>
      }
    >
      <BodyCheckResultContent />
    </Suspense>
  );
}
