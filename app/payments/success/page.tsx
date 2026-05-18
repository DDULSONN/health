"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

type ConfirmResponse = {
  ok?: boolean;
  orderId?: string;
  paymentKey?: string;
  productType?: string;
  readingId?: string | null;
  amount?: number;
  method?: string | null;
  addedCredits?: number;
  creditsAfter?: number;
  alreadyConfirmed?: boolean;
  message?: string;
};

type LoveFortuneReading = {
  id: string;
  status: string;
  calendarType: string;
  birthDate: string;
  birthTime: string;
  birthTimeCertainty: string;
  birthPlace: string | null;
  gender: string;
  loveState: string | null;
  relationshipGoal: string | null;
  meetingPreference: string | null;
  focus: string | null;
  concern: string | null;
  amount: number;
  aiResult: string | null;
  idealFace: {
    title?: string;
    eye?: string;
    smile?: string;
    mood?: string;
    style?: string;
    firstDate?: string;
    avoid?: string;
    note?: string;
  } | null;
  generatedAt: string | null;
  createdAt: string;
};

const STEMS = [
  { ko: "갑", hanja: "甲", element: "목", color: "text-emerald-700", bg: "bg-emerald-50" },
  { ko: "을", hanja: "乙", element: "목", color: "text-emerald-700", bg: "bg-emerald-50" },
  { ko: "병", hanja: "丙", element: "화", color: "text-red-600", bg: "bg-red-50" },
  { ko: "정", hanja: "丁", element: "화", color: "text-red-600", bg: "bg-red-50" },
  { ko: "무", hanja: "戊", element: "토", color: "text-amber-700", bg: "bg-amber-50" },
  { ko: "기", hanja: "己", element: "토", color: "text-amber-700", bg: "bg-amber-50" },
  { ko: "경", hanja: "庚", element: "금", color: "text-slate-700", bg: "bg-slate-50" },
  { ko: "신", hanja: "辛", element: "금", color: "text-slate-700", bg: "bg-slate-50" },
  { ko: "임", hanja: "壬", element: "수", color: "text-blue-700", bg: "bg-blue-50" },
  { ko: "계", hanja: "癸", element: "수", color: "text-blue-700", bg: "bg-blue-50" },
];

const BRANCHES = [
  { ko: "자", hanja: "子", animal: "쥐", element: "수" },
  { ko: "축", hanja: "丑", animal: "소", element: "토" },
  { ko: "인", hanja: "寅", animal: "호랑이", element: "목" },
  { ko: "묘", hanja: "卯", animal: "토끼", element: "목" },
  { ko: "진", hanja: "辰", animal: "용", element: "토" },
  { ko: "사", hanja: "巳", animal: "뱀", element: "화" },
  { ko: "오", hanja: "午", animal: "말", element: "화" },
  { ko: "미", hanja: "未", animal: "양", element: "토" },
  { ko: "신", hanja: "申", animal: "원숭이", element: "금" },
  { ko: "유", hanja: "酉", animal: "닭", element: "금" },
  { ko: "술", hanja: "戌", animal: "개", element: "토" },
  { ko: "해", hanja: "亥", animal: "돼지", element: "수" },
];

function formatProductType(productType?: string) {
  if (productType === "apply_credits") return "오픈카드 지원권";
  if (productType === "paid_card") return "대기 없이 등록";
  if (productType === "more_view") return "이상형 더보기";
  if (productType === "city_view") return "가까운 이상형 보기";
  if (productType === "one_on_one_contact_exchange") return "1:1 번호 즉시 교환";
  if (productType === "swipe_premium_30d") return "빠른매칭 플러스";
  if (productType === "love_fortune_detail") return "연애운 상세 풀이";
  return "-";
}

function getPrimaryAction(productType?: string) {
  if (productType === "paid_card") return { href: "/dating/paid", label: "대기 없이 등록으로 돌아가기" };
  if (productType === "one_on_one_contact_exchange") return { href: "/mypage", label: "마이페이지로 돌아가기" };
  if (productType === "swipe_premium_30d") return { href: "/community/dating/cards", label: "빠른매칭으로 돌아가기" };
  if (productType === "city_view") return { href: "/dating/nearby-view", label: "가까운 이상형 보기로 돌아가기" };
  if (productType === "love_fortune_detail") return { href: "/mypage?loveFortune=1#love-fortune", label: "저장된 풀이 보기" };
  return { href: "/dating/more-view", label: "이상형 더보기로 돌아가기" };
}

function parseLoveFortuneReport(text: string | null) {
  if (!text) return [];
  const sections: Array<{ title: string; body: string }> = [];
  let currentTitle = "상세 풀이";
  let currentLines: string[] = [];

  for (const rawLine of text.replace(/```/g, "").split(/\r?\n/)) {
    const heading = rawLine.trim().match(/^#{1,3}\s+(.+)$/);
    if (heading) {
      if (currentLines.join("\n").trim()) {
        sections.push({ title: currentTitle, body: currentLines.join("\n").trim() });
      }
      currentTitle = heading[1]?.trim() || "상세 풀이";
      currentLines = [];
      continue;
    }
    currentLines.push(rawLine);
  }

  if (currentLines.join("\n").trim()) {
    sections.push({ title: currentTitle, body: currentLines.join("\n").trim() });
  }

  return sections.length > 0 ? sections : [{ title: "상세 풀이", body: text.trim() }];
}

function seedFromReading(reading: LoveFortuneReading | null) {
  const raw = reading
    ? [reading.birthDate, reading.birthTime, reading.loveState, reading.relationshipGoal, reading.meetingPreference, reading.focus, reading.concern].join("|")
    : "love-fortune";
  return raw.split("").reduce((sum, char) => sum + char.charCodeAt(0), 0);
}

function buildFortuneSummary(reading: LoveFortuneReading | null) {
  const seed = seedFromReading(reading);
  const stem = STEMS[seed % STEMS.length];
  const branch = BRANCHES[(seed + 5) % BRANCHES.length];
  const monthStem = STEMS[(seed + 3) % STEMS.length];
  const monthBranch = BRANCHES[(seed + 8) % BRANCHES.length];
  const yearStem = STEMS[(seed + 6) % STEMS.length];
  const yearBranch = BRANCHES[(seed + 1) % BRANCHES.length];
  const scores = [
    { label: "연애 표현력", value: 78 + (seed % 17) },
    { label: "관계 안정감", value: 74 + ((seed + 7) % 19) },
    { label: "호감 지속력", value: 76 + ((seed + 11) % 18) },
    { label: "소개팅 행동력", value: 72 + ((seed + 13) % 21) },
  ];
  const pillars = [
    { label: "일주", stem, branch },
    { label: "월주", stem: monthStem, branch: monthBranch },
    { label: "년주", stem: yearStem, branch: yearBranch },
  ];

  return { stem, branch, pillars, scores };
}

function LoveFortuneResultPanel({ reading }: { reading: LoveFortuneReading }) {
  const sections = useMemo(() => parseLoveFortuneReport(reading.aiResult), [reading.aiResult]);
  const summary = useMemo(() => buildFortuneSummary(reading), [reading]);
  const ideal = reading.idealFace ?? {};
  const firstSection = sections[0];
  const detailSections = sections.slice(1);

  return (
    <section className="mt-6 overflow-hidden rounded-[32px] border border-amber-200 bg-[#fbf4e8] text-[#2b2118] shadow-[0_20px_60px_rgba(61,38,20,0.12)]">
      <div className="border-b border-amber-200/70 bg-[radial-gradient(circle_at_20%_0%,rgba(251,191,36,0.22),transparent_34%),linear-gradient(135deg,#fff8ec,#f6ead8)] p-5 sm:p-7">
        <p className="text-xs font-black tracking-[0.24em] text-amber-800">사랑운 명식 풀이</p>
        <h2 className="mt-3 text-3xl font-black tracking-tight text-[#24170f] sm:text-4xl">사주풀이 결과</h2>
        <p className="mt-2 text-sm leading-6 text-stone-600">
          결제 확인 후 바로 생성된 상세 풀이입니다. 결과는 마이페이지에도 저장돼요.
        </p>
      </div>

      <div className="grid gap-4 p-5 sm:p-7 lg:grid-cols-[0.9fr_1.1fr]">
        <div className="rounded-3xl border border-amber-200 bg-white/75 p-4">
          <p className="text-sm font-black text-stone-800">입력 기반 명식 요약</p>
          <p className="mt-1 text-xs leading-5 text-stone-500">정식 만세력 단정이 아닌 입력 기반 상담용 요약입니다.</p>

          <div className="mt-4 grid grid-cols-3 overflow-hidden rounded-2xl border-2 border-stone-800 bg-white text-center">
            {summary.pillars.map((pillar) => (
              <div key={pillar.label} className="border-r border-stone-200 last:border-r-0">
                <p className="border-b border-stone-200 bg-stone-50 py-2 text-xs font-black text-stone-500">{pillar.label}</p>
                <div className={`${pillar.stem.bg} px-2 py-4`}>
                  <p className={`text-4xl font-black ${pillar.stem.color}`}>{pillar.stem.ko}</p>
                  <p className="text-sm font-bold text-stone-500">{pillar.stem.hanja} · {pillar.stem.element}</p>
                </div>
                <div className="border-t border-stone-200 px-2 py-4">
                  <p className="text-3xl font-black text-stone-800">{pillar.branch.ko}</p>
                  <p className="text-sm font-bold text-stone-500">{pillar.branch.hanja} · {pillar.branch.animal}</p>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-4 grid grid-cols-2 gap-2">
            {summary.scores.map((score) => (
              <div key={score.label} className="rounded-2xl border border-amber-100 bg-[#f7efe4] p-3">
                <p className="text-xs font-bold text-stone-500">{score.label}</p>
                <p className="mt-2 text-2xl font-black text-red-700">{score.value}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="space-y-4">
          <div className="rounded-3xl border border-amber-200 bg-white p-5">
            <p className="text-xs font-black tracking-[0.18em] text-amber-700">총평</p>
            <h3 className="mt-2 text-2xl font-black leading-9 text-stone-950">{firstSection?.body || "상세 풀이가 생성되었습니다."}</h3>
          </div>

          <div className="rounded-3xl border border-rose-100 bg-white p-5">
            <p className="text-sm font-black text-rose-950">{String(ideal.title ?? "잘 맞는 인상 미리보기")}</p>
            <div className="mt-3 grid gap-2 text-sm leading-6 text-stone-700 sm:grid-cols-2">
              <p className="rounded-2xl bg-rose-50 p-3">눈매 · {String(ideal.eye ?? "편안하게 오래 마주볼 수 있는 눈매")}</p>
              <p className="rounded-2xl bg-rose-50 p-3">미소 · {String(ideal.smile ?? "담백하지만 따뜻한 미소")}</p>
              <p className="rounded-2xl bg-rose-50 p-3">분위기 · {String(ideal.mood ?? "편안하고 신뢰감 있는 분위기")}</p>
              <p className="rounded-2xl bg-rose-50 p-3">첫 만남 · {String(ideal.firstDate ?? "대화가 편한 사람")}</p>
            </div>
          </div>
        </div>
      </div>

      <div className="space-y-3 px-5 pb-6 sm:px-7">
        {detailSections.map((section, index) => (
          <details key={`${section.title}-${index}`} className="rounded-3xl border border-amber-100 bg-white p-5" open={index < 3}>
            <summary className="cursor-pointer text-base font-black text-stone-950">{section.title}</summary>
            <div className="mt-3 whitespace-pre-wrap text-[15px] leading-8 text-stone-700">{section.body}</div>
          </details>
        ))}
      </div>
    </section>
  );
}

function PaymentSuccessContent() {
  const searchParams = useSearchParams();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [result, setResult] = useState<ConfirmResponse | null>(null);
  const [fortuneLoading, setFortuneLoading] = useState(false);
  const [fortuneError, setFortuneError] = useState("");
  const [fortuneReading, setFortuneReading] = useState<LoveFortuneReading | null>(null);

  useEffect(() => {
    const paymentKey = searchParams.get("paymentKey") ?? "";
    const orderId = searchParams.get("orderId") ?? "";
    const amount = searchParams.get("amount") ?? "";

    if (!paymentKey || !orderId || !amount) {
      setError("결제 확인 정보가 올바르지 않습니다.");
      setLoading(false);
      return;
    }

    let cancelled = false;
    queueMicrotask(async () => {
      try {
        const res = await fetch("/api/payments/toss/confirm", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ paymentKey, orderId, amount }),
        });
        const body = (await res.json().catch(() => ({}))) as ConfirmResponse;
        if (!res.ok || !body.ok) {
          if (!cancelled) setError(body.message ?? "결제 확인 처리에 실패했습니다.");
          return;
        }
        if (!cancelled) setResult(body);
      } catch {
        if (!cancelled) setError("결제 확인 중 서버 오류가 발생했습니다.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [searchParams]);

  useEffect(() => {
    if (result?.productType !== "love_fortune_detail" || !result.readingId || fortuneReading || fortuneLoading) return;

    let cancelled = false;
    setFortuneLoading(true);
    setFortuneError("");
    queueMicrotask(async () => {
      try {
        const res = await fetch("/api/mypage/love-fortune", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ readingId: result.readingId }),
        });
        const body = (await res.json().catch(() => ({}))) as { ok?: boolean; message?: string; reading?: LoveFortuneReading };
        if (!res.ok || !body.ok || !body.reading) {
          throw new Error(body.message ?? "연애운 상세 풀이를 생성하지 못했습니다.");
        }
        if (!cancelled) setFortuneReading(body.reading);
      } catch (err) {
        if (!cancelled) setFortuneError(err instanceof Error ? err.message : "연애운 상세 풀이를 생성하지 못했습니다.");
      } finally {
        if (!cancelled) setFortuneLoading(false);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [fortuneLoading, fortuneReading, result]);

  const primaryAction = getPrimaryAction(result?.productType);
  const isLoveFortune = result?.productType === "love_fortune_detail";

  return (
    <main className={`mx-auto px-4 py-8 ${isLoveFortune ? "max-w-5xl" : "max-w-2xl"}`}>
      <section className="rounded-3xl border border-neutral-200 bg-white p-6 shadow-sm">
        <h1 className="text-2xl font-bold text-neutral-900">결제가 완료됐어요</h1>

        {loading ? <p className="mt-4 text-sm text-neutral-500">결제 상태를 확인하고 있어요.</p> : null}
        {error ? <p className="mt-4 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</p> : null}

        {!loading && !error && result ? (
          <div className="mt-4 space-y-3">
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
              <p className="text-sm font-semibold text-emerald-800">
                {result.alreadyConfirmed ? "이미 처리된 결제예요." : "결제가 정상적으로 확인됐어요."}
              </p>
              <p className="mt-1 text-sm text-emerald-900">주문번호: {result.orderId ?? "-"}</p>
              {isLoveFortune ? (
                <p className="mt-1 text-sm font-semibold text-emerald-900">잠시만 기다리면 이 화면에서 바로 상세 풀이가 열립니다.</p>
              ) : (
                <p className="mt-1 text-sm text-emerald-900">결제 키: {result.paymentKey ?? "-"}</p>
              )}
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-2xl border border-neutral-200 bg-neutral-50 p-4 text-sm text-neutral-700">
                <p className="text-xs font-medium text-neutral-500">상품</p>
                <p className="mt-1 font-semibold text-neutral-900">{formatProductType(result.productType)}</p>
              </div>
              <div className="rounded-2xl border border-neutral-200 bg-neutral-50 p-4 text-sm text-neutral-700">
                <p className="text-xs font-medium text-neutral-500">결제 금액</p>
                <p className="mt-1 font-semibold text-neutral-900">
                  {typeof result.amount === "number" ? `${result.amount.toLocaleString("ko-KR")}원` : "-"}
                </p>
              </div>
              <div className="rounded-2xl border border-neutral-200 bg-neutral-50 p-4 text-sm text-neutral-700">
                <p className="text-xs font-medium text-neutral-500">결제 수단</p>
                <p className="mt-1 font-semibold text-neutral-900">{result.method ?? "-"}</p>
              </div>
              <div className="rounded-2xl border border-neutral-200 bg-neutral-50 p-4 text-sm text-neutral-700">
                <p className="text-xs font-medium text-neutral-500">적용 결과</p>
                <p className="mt-1 font-semibold text-neutral-900">
                  {typeof result.addedCredits === "number" && result.addedCredits > 0
                    ? `지원권 +${result.addedCredits}장 / 현재 ${result.creditsAfter ?? 0}장`
                    : result.productType === "paid_card"
                      ? "대기 없이 등록 결제가 반영됐어요"
                      : result.productType === "one_on_one_contact_exchange"
                        ? "상대 연락처 즉시 공개"
                        : result.productType === "swipe_premium_30d"
                          ? "빠른매칭 플러스 적용 완료"
                          : result.productType === "city_view"
                            ? "가까운 이상형 보기 권한 반영 완료"
                            : result.productType === "love_fortune_detail"
                              ? "연애운 상세 풀이 생성 준비 완료"
                              : "결제 반영 완료"}
                </p>
              </div>
            </div>
          </div>
        ) : null}

        {isLoveFortune && fortuneLoading ? (
          <div className="mt-6 rounded-3xl border border-amber-200 bg-amber-50 p-5">
            <p className="text-sm font-black text-amber-900">도화냥이 명식 흐름을 짚고 있어요.</p>
            <div className="mt-4 h-2 overflow-hidden rounded-full bg-amber-100">
              <div className="h-full w-2/3 animate-pulse rounded-full bg-amber-700" />
            </div>
            <p className="mt-3 text-sm leading-6 text-amber-800">결과가 나오면 이 화면에 바로 펼쳐집니다. 창을 닫아도 마이페이지에 저장돼요.</p>
          </div>
        ) : null}

        {isLoveFortune && fortuneError ? (
          <div className="mt-6 rounded-3xl border border-red-200 bg-red-50 p-5">
            <p className="text-sm font-bold text-red-800">{fortuneError}</p>
            <p className="mt-2 text-sm text-red-700">결제는 반영됐으니 마이페이지에서 다시 생성할 수 있어요.</p>
          </div>
        ) : null}

        {!isLoveFortune ? (
          <div className="mt-6 flex flex-wrap gap-3">
            <Link
              href={primaryAction.href}
              className="inline-flex min-h-[44px] items-center rounded-xl bg-emerald-600 px-4 text-sm font-semibold text-white hover:bg-emerald-700"
            >
              {primaryAction.label}
            </Link>
            <Link
              href="/mypage"
              className="inline-flex min-h-[44px] items-center rounded-xl border border-neutral-300 bg-white px-4 text-sm font-medium text-neutral-700 hover:bg-neutral-50"
            >
              마이페이지
            </Link>
          </div>
        ) : null}
      </section>

      {fortuneReading ? <LoveFortuneResultPanel reading={fortuneReading} /> : null}

      {isLoveFortune ? (
        <div className="mt-6 flex flex-wrap gap-3">
          <Link
            href={primaryAction.href}
            className="inline-flex min-h-[44px] items-center rounded-xl bg-stone-900 px-4 text-sm font-semibold text-white hover:bg-stone-800"
          >
            {primaryAction.label}
          </Link>
          <Link
            href="/community/dating/cards"
            className="inline-flex min-h-[44px] items-center rounded-xl border border-neutral-300 bg-white px-4 text-sm font-medium text-neutral-700 hover:bg-neutral-50"
          >
            연애운으로 돌아가기
          </Link>
        </div>
      ) : null}
    </main>
  );
}

export default function PaymentSuccessPage() {
  return (
    <Suspense
      fallback={
        <main className="mx-auto max-w-2xl px-4 py-8">
          <section className="rounded-3xl border border-neutral-200 bg-white p-6 shadow-sm">
            <h1 className="text-2xl font-bold text-neutral-900">결제가 완료됐어요</h1>
            <p className="mt-4 text-sm text-neutral-500">결제 상태를 확인하고 있어요.</p>
          </section>
        </main>
      }
    >
      <PaymentSuccessContent />
    </Suspense>
  );
}
