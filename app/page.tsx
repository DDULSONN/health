import Link from "next/link";

/**
 * 홈: 앱 설명 + 시작하기 버튼 + 개인정보 안내
 */

export default function HomePage() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center p-6 max-w-md mx-auto">
      <div className="text-center space-y-6">
        <h1 className="text-2xl font-bold text-neutral-900">
          헬창 판독기
        </h1>
        <p className="text-neutral-600 leading-relaxed">
          20가지 질문에 답하면, 당신의 헬스 스타일을 10가지 유형 중 하나로 알려줘요.
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
            <strong>개인정보 안내</strong>: 답변 데이터는 서버로 전송되지 않으며, 브라우저(localStorage)에만 저장됩니다. 시크릿 모드에서는 저장되지 않을 수 있습니다.
          </p>
        </div>
      </div>
    </main>
  );
}
