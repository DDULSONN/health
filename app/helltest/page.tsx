import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "헬창 판독기 | 짐툴 GymTools",
  description:
    "20문항으로 나의 헬창 성향을 테스트하고 10가지 유형 중 결과를 확인하세요.",
};

export default function HellTestPage() {
  return (
    <main className="max-w-md mx-auto px-4 py-12 flex flex-col items-center justify-center min-h-[70vh]">
      <div className="text-center space-y-6">
        <span className="text-5xl block" aria-hidden>
          🧪
        </span>
        <h1 className="text-2xl font-bold text-neutral-900">헬창 판독기</h1>
        <p className="text-neutral-600 leading-relaxed">
          20가지 질문을 통해 나의 헬창 성향을
          <br />
          10가지 유형 중 하나로 알려드려요.
          <br />
          가볍게 재미로 참여해 보세요.
        </p>
        <Link
          href="/test"
          className="inline-block min-h-[56px] px-8 py-3 rounded-xl bg-emerald-600 text-white font-medium text-lg hover:bg-emerald-700 active:scale-[0.98] transition-all"
        >
          시작하기
        </Link>
        <div className="pt-4 border-t border-neutral-200 text-left">
          <p className="text-sm text-neutral-500">
            <strong>개인정보 안내</strong>: 답변 데이터는 서버로 전송하지 않으며 브라우저
            (localStorage)에만 저장됩니다.
          </p>
        </div>
      </div>
    </main>
  );
}
