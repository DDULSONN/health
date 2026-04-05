import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { DEFAULT_OPENKAKAO_URL } from "@/lib/ad-inquiry";
import { createClient } from "@/lib/supabase/server";
import { isAllowedTestPaymentEmail } from "@/lib/test-payment";
import TestPaymentPageClient from "@/components/TestPaymentPageClient";

type SearchParams = Promise<{
  nickname?: string;
}>;

export default async function TestPaymentPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login?redirect=/payments/test");
  }

  if (!isAllowedTestPaymentEmail(user.email)) {
    notFound();
  }

  const profileRes = await supabase
    .from("profiles")
    .select("nickname")
    .eq("user_id", user.id)
    .maybeSingle();

  const params = await searchParams;
  const nickname = profileRes.data?.nickname?.trim() || params.nickname?.trim() || "결제계정";
  const email = user.email ?? "-";

  return (
    <main className="mx-auto max-w-4xl px-4 py-8">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <span className="rounded-full border border-emerald-300 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
          PAYMENT CENTER
        </span>
        <span className="rounded-full border border-neutral-200 bg-white px-3 py-1 text-xs text-neutral-600">
          결제 전용 계정
        </span>
      </div>

      <section className="rounded-3xl border border-neutral-200 bg-white p-6 shadow-sm">
        <h1 className="text-2xl font-bold text-neutral-900">결제 센터</h1>
        <p className="mt-3 text-sm leading-6 text-neutral-600">
          지원권 구매와 유료 등록 결제를 진행할 수 있는 전용 화면입니다.
          <br />
          기존 오픈카톡 결제 흐름은 그대로 유지되며, 현재는 이 계정에서만 결제 흐름을 확인할 수 있습니다.
        </p>

        <div className="mt-6 rounded-2xl border border-neutral-200 bg-neutral-50 p-4">
          <p className="text-sm font-semibold text-neutral-900">결제 안내</p>
          <ul className="mt-3 space-y-2 text-sm leading-6 text-neutral-700">
            <li>지원권 구매 시 결제 완료 후 자동 지급 여부를 확인합니다.</li>
            <li>유료카드 등록 결제 시 결제 승인과 결과 페이지 흐름을 확인합니다.</li>
            <li>결제 완료 후 성공 페이지에서 주문번호와 승인 결과를 바로 확인할 수 있습니다.</li>
          </ul>
        </div>

        <TestPaymentPageClient nickname={nickname} email={email} />

        <div className="mt-6 grid gap-3 md:grid-cols-2">
          <div className="rounded-2xl border border-neutral-200 bg-neutral-50 p-4">
            <p className="text-sm font-semibold text-neutral-900">상품 및 문의</p>
            <ul className="mt-2 space-y-1 text-xs leading-5 text-neutral-600">
              <li>지원권 3장 구매</li>
              <li>오픈카드 유료 등록 결제</li>
              <li>문의: gymtools.kr@gmail.com / 010-8693-0657</li>
            </ul>
          </div>
          <div className="rounded-2xl border border-neutral-200 bg-neutral-50 p-4">
            <p className="text-sm font-semibold text-neutral-900">운영자 정보</p>
            <ul className="mt-2 space-y-1 text-xs leading-5 text-neutral-600">
              <li>상호명: 알파핏</li>
              <li>대표자: 김준호</li>
              <li>이메일: gymtools.kr@gmail.com</li>
              <li>연락처: 010-8693-0657</li>
            </ul>
          </div>
        </div>

        <div className="mt-6 flex flex-wrap gap-3">
          <a
            href={DEFAULT_OPENKAKAO_URL}
            target="_blank"
            rel="noreferrer"
            className="inline-flex min-h-[44px] items-center rounded-xl border border-neutral-300 bg-white px-4 text-sm font-medium text-neutral-700 hover:bg-neutral-50"
          >
            기존 오픈카톡 문의 열기
          </a>
          <Link
            href="/mypage"
            className="inline-flex min-h-[44px] items-center rounded-xl border border-neutral-300 bg-white px-4 text-sm font-medium text-neutral-700 hover:bg-neutral-50"
          >
            마이페이지로 돌아가기
          </Link>
        </div>
      </section>
    </main>
  );
}
