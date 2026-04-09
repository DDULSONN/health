import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { DEFAULT_OPENKAKAO_URL } from "@/lib/ad-inquiry";
import { createClient } from "@/lib/supabase/server";
import { isAllowedTestPaymentEmail } from "@/lib/test-payment";
import TestPaymentPageClient from "@/components/TestPaymentPageClient";

type SearchParams = Promise<{
  nickname?: string;
}>;

type TestPaymentOrderRow = {
  id: string;
  product_type: "apply_credits" | "paid_card";
  toss_order_id: string;
  order_name: string;
  amount: number;
  status: "ready" | "paid" | "failed" | "canceled";
  approved_at: string | null;
  created_at: string;
};

function formatOrderStatus(status: TestPaymentOrderRow["status"]) {
  switch (status) {
    case "paid":
      return "결제 완료";
    case "failed":
      return "결제 실패";
    case "canceled":
      return "결제 취소";
    default:
      return "결제 대기";
  }
}

function formatServiceResult(order: TestPaymentOrderRow) {
  if (order.status !== "paid") {
    return "결제 승인 대기";
  }
  if (order.product_type === "apply_credits") {
    return "지원권 지급 완료";
  }
  return "유료카드 결제 확인 완료";
}

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

  const [profileRes, ordersRes, params] = await Promise.all([
    supabase.from("profiles").select("nickname").eq("user_id", user.id).maybeSingle(),
    supabase
      .from("toss_test_payment_orders")
      .select("id,product_type,toss_order_id,order_name,amount,status,approved_at,created_at")
      .order("created_at", { ascending: false })
      .limit(20),
    searchParams,
  ]);

  const nickname = profileRes.data?.nickname?.trim() || params.nickname?.trim() || "결제계정";
  const email = user.email ?? "-";
  const orders = (ordersRes.data ?? []) as TestPaymentOrderRow[];

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
          지원권 구매와 유료카드 등록 결제를 테스트할 수 있는 전용 화면입니다.
          <br />
          기존 오픈카톡 결제 흐름은 그대로 두고, 현재는 이 계정에서만 결제 흐름과 구매내역을 확인합니다.
        </p>

        <div className="mt-6 rounded-2xl border border-neutral-200 bg-neutral-50 p-4">
          <p className="text-sm font-semibold text-neutral-900">결제 안내</p>
          <ul className="mt-3 space-y-2 text-sm leading-6 text-neutral-700">
            <li>지원권 구매는 결제 완료 후 지급 결과까지 바로 확인할 수 있습니다.</li>
            <li>유료카드 등록 결제는 결제 확인 흐름과 결과 화면을 점검하기 위한 용도입니다.</li>
            <li>최근 주문과 서비스 제공 상태는 아래 구매내역에서 확인할 수 있습니다.</li>
          </ul>
        </div>

        <TestPaymentPageClient nickname={nickname} email={email} />

        <section className="mt-6 rounded-2xl border border-neutral-200 bg-neutral-50 p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-neutral-900">구매내역</p>
              <p className="mt-1 text-xs text-neutral-500">
                최근 결제 주문과 서비스 제공 상태를 이 계정에서만 확인할 수 있습니다.
              </p>
            </div>
            <span className="rounded-full border border-neutral-200 bg-white px-3 py-1 text-xs font-medium text-neutral-600">
              최근 {orders.length}건
            </span>
          </div>

          {orders.length === 0 ? (
            <div className="mt-4 rounded-2xl border border-dashed border-neutral-300 bg-white p-4 text-sm text-neutral-500">
              아직 결제 내역이 없습니다.
            </div>
          ) : (
            <div className="mt-4 space-y-3">
              {orders.map((order) => (
                <article key={order.id} className="rounded-2xl border border-neutral-200 bg-white p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-neutral-900">{order.order_name}</p>
                      <p className="mt-1 text-xs text-neutral-500">주문번호 {order.toss_order_id}</p>
                    </div>
                    <span
                      className={`rounded-full px-3 py-1 text-xs font-semibold ${
                        order.status === "paid"
                          ? "bg-emerald-100 text-emerald-700"
                          : order.status === "ready"
                            ? "bg-amber-100 text-amber-700"
                            : "bg-neutral-200 text-neutral-700"
                      }`}
                    >
                      {formatOrderStatus(order.status)}
                    </span>
                  </div>

                  <div className="mt-3 grid gap-3 text-sm text-neutral-700 md:grid-cols-3">
                    <div>
                      <p className="text-xs text-neutral-500">결제 금액</p>
                      <p className="mt-1 font-semibold text-neutral-900">{order.amount.toLocaleString("ko-KR")}원</p>
                    </div>
                    <div>
                      <p className="text-xs text-neutral-500">결제 시각</p>
                      <p className="mt-1">{new Date(order.created_at).toLocaleString("ko-KR")}</p>
                    </div>
                    <div>
                      <p className="text-xs text-neutral-500">서비스 제공</p>
                      <p className="mt-1 font-medium text-neutral-900">{formatServiceResult(order)}</p>
                    </div>
                  </div>

                  {order.approved_at ? (
                    <p className="mt-3 text-xs text-emerald-700">
                      승인 완료 시각: {new Date(order.approved_at).toLocaleString("ko-KR")}
                    </p>
                  ) : null}
                </article>
              ))}
            </div>
          )}
        </section>

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
