"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import DatingAdultNotice from "@/components/DatingAdultNotice";
import PaidPolicyNotice from "@/components/PaidPolicyNotice";

type MoreViewStatus = "none" | "pending" | "approved" | "rejected";
type MoreViewStatusResponse = {
  ok?: boolean;
  loggedIn?: boolean;
  male?: MoreViewStatus;
  female?: MoreViewStatus;
};

type MoreViewCard = {
  id: string;
  display_nickname: string | null;
  age: number | null;
  region: string | null;
  height_cm: number | null;
  job: string | null;
  ideal_type: string | null;
  image_urls: string[];
};

const OPEN_KAKAO_URL = "https://open.kakao.com/o/s2gvTdhi";

function MoreViewCardTile({ card }: { card: MoreViewCard }) {
  const imageUrl = card.image_urls[0] ?? null;

  return (
    <div className="overflow-hidden rounded-[26px] border border-neutral-200 bg-white shadow-[0_10px_30px_rgba(15,23,42,0.05)]">
      <div className="aspect-[4/5] bg-neutral-100">
        {imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={imageUrl} alt="" className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-neutral-400">사진 없음</div>
        )}
      </div>
      <div className="p-4">
        <div className="flex items-end gap-2">
          <p className="text-lg font-black text-neutral-950">{card.display_nickname ?? "오픈카드"}</p>
          {card.age != null ? <span className="text-sm font-semibold text-neutral-500">{card.age}세</span> : null}
        </div>
        <div className="mt-2 flex flex-wrap gap-2 text-xs font-semibold text-neutral-500">
          {card.region ? <span className="rounded-full bg-neutral-100 px-3 py-1">{card.region}</span> : null}
          {card.height_cm != null ? <span className="rounded-full bg-neutral-100 px-3 py-1">{card.height_cm}cm</span> : null}
          {card.job ? <span className="rounded-full bg-neutral-100 px-3 py-1">{card.job}</span> : null}
        </div>
        {card.ideal_type ? <p className="mt-3 line-clamp-2 text-sm leading-6 text-neutral-600">{card.ideal_type}</p> : null}
        <div className="mt-4 flex flex-wrap gap-2">
          <Link
            href={`/community/dating/cards/${card.id}`}
            className="inline-flex min-h-[36px] items-center rounded-xl border border-neutral-300 bg-white px-3 text-xs font-medium text-neutral-700 hover:bg-neutral-100"
          >
            상세보기
          </Link>
          <Link
            href={`/community/dating/cards/${card.id}/apply`}
            className="inline-flex min-h-[36px] items-center rounded-xl bg-rose-600 px-3 text-xs font-semibold text-white hover:bg-rose-700"
          >
            지원하기
          </Link>
        </div>
      </div>
    </div>
  );
}

export default function MoreViewPage() {
  const [status, setStatus] = useState<{ loggedIn: boolean; male: MoreViewStatus; female: MoreViewStatus }>({
    loggedIn: false,
    male: "none",
    female: "none",
  });
  const isAdmin = true;
  const adminChecked = true;
  const [submitting, setSubmitting] = useState<null | "male" | "female">(null);
  const [maleItems, setMaleItems] = useState<MoreViewCard[]>([]);
  const [femaleItems, setFemaleItems] = useState<MoreViewCard[]>([]);

  const loadApprovedList = useCallback(async (sex: "male" | "female") => {
    const res = await fetch(`/api/dating/cards/more-view/list?sex=${sex}`, { cache: "no-store" });
    if (!res.ok) return [];
    const body = (await res.json().catch(() => ({}))) as { items?: MoreViewCard[] };
    return Array.isArray(body.items) ? body.items : [];
  }, []);

  const loadStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/dating/cards/more-view/status", { cache: "no-store" });
      if (!res.ok) return;
      const body = (await res.json().catch(() => ({}))) as MoreViewStatusResponse;
      const nextStatus = {
        loggedIn: body.loggedIn === true,
        male: body.male ?? "none",
        female: body.female ?? "none",
      };
      setStatus(nextStatus);

      if (nextStatus.male === "approved") {
        setMaleItems(await loadApprovedList("male"));
      } else {
        setMaleItems([]);
      }

      if (nextStatus.female === "approved") {
        setFemaleItems(await loadApprovedList("female"));
      } else {
        setFemaleItems([]);
      }
    } catch {
      // ignore
    }
  }, [loadApprovedList]);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  const requestCheckout = useCallback(
    async (sex: "male" | "female") => {
      if (submitting) return;
      setSubmitting(sex);
      try {
        const res = await fetch("/api/payments/toss/create", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ productType: "more_view", sex }),
        });
        const body = (await res.json().catch(() => ({}))) as {
          ok?: boolean;
          message?: string;
          checkoutUrl?: string;
          recovered?: boolean;
        };

        if (!res.ok) {
          alert(body.message ?? "결제 요청에 실패했습니다.");
          return;
        }

        if (body.recovered) {
          await loadStatus();
          alert(body.message ?? "이전 결제 내역을 확인해 권한을 복구했습니다.");
          return;
        }

        if (!body.checkoutUrl) {
          alert(body.message ?? "결제창을 불러오지 못했습니다.");
          return;
        }

        window.location.href = body.checkoutUrl;
      } catch {
        alert("결제 요청 처리 중 오류가 발생했습니다.");
      } finally {
        setSubmitting(null);
      }
    },
    [loadStatus, submitting]
  );

  return (
    <main className="mx-auto max-w-5xl px-4 py-6">
      <div className="mb-4 flex items-center gap-2">
        <Link href="/community/dating/cards" className="rounded-full border border-neutral-300 bg-white px-3 py-1.5 text-sm font-medium text-neutral-700 hover:bg-neutral-50">
          오픈카드
        </Link>
        <Link href="/dating/apply-credits" className="rounded-full border border-neutral-300 bg-white px-3 py-1.5 text-sm font-medium text-neutral-700 hover:bg-neutral-50">
          지원권 구매
        </Link>
        <span className="rounded-full border border-rose-200 bg-rose-50 px-3 py-1.5 text-sm font-semibold text-rose-700">이상형 더보기</span>
      </div>

      <section className="rounded-[28px] border border-neutral-200 bg-white p-5 shadow-[0_10px_30px_rgba(15,23,42,0.04)]">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div className="max-w-2xl">
            <h1 className="text-[28px] font-black tracking-tight text-neutral-950">이상형 더보기</h1>
            <p className="mt-2 text-sm text-neutral-600">대기열 프로필을 먼저 확인하고, 마음에 들면 바로 지원할 수 있어요.</p>
            <div className="mt-4 flex flex-wrap gap-2">
              <span className="rounded-full border border-neutral-200 bg-neutral-50 px-3 py-1 text-xs font-semibold text-neutral-700">3시간 이용</span>
              <span className="rounded-full border border-neutral-200 bg-neutral-50 px-3 py-1 text-xs font-semibold text-neutral-700">5,000원</span>
              <span className="rounded-full border border-neutral-200 bg-neutral-50 px-3 py-1 text-xs font-semibold text-neutral-700">지원권 1장 추가</span>
            </div>
            <p className="mt-3 text-xs text-neutral-500">현재는 카카오페이 간편결제로만 결제 가능해요. 그 밖의 결제 문의는 오픈카톡으로 부탁드려요.</p>
          </div>

          <div className="w-full rounded-[24px] border border-neutral-200 bg-neutral-50 p-4 md:max-w-sm">
            <p className="text-sm font-semibold text-neutral-800">이용 안내</p>
            <ul className="mt-2 space-y-1 text-xs leading-5 text-neutral-600">
              <li>결제 후 3시간 동안 해당 성별 카드가 바로 열립니다.</li>
              <li>이용이 시작되면 지원권 1장이 함께 지급됩니다.</li>
              <li>추가 결제나 예외 문의는 오픈카톡으로 이어서 도와드릴게요.</li>
            </ul>
            <a
              href={OPEN_KAKAO_URL}
              target="_blank"
              rel="noreferrer"
              className="mt-4 inline-flex min-h-[40px] items-center rounded-xl border border-neutral-300 bg-white px-3 text-xs font-medium text-neutral-700 hover:bg-neutral-100"
            >
              오픈카톡 문의
            </a>
          </div>
        </div>

        <div className="mt-5 grid gap-3 md:grid-cols-2">
          {[
            { sex: "male" as const, title: "남자 카드 보기", status: status.male, items: maleItems },
            { sex: "female" as const, title: "여자 카드 보기", status: status.female, items: femaleItems },
          ].map((section) => (
            <div key={section.sex} className="rounded-[24px] border border-neutral-200 bg-neutral-50 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-base font-black text-neutral-950">{section.title}</p>
                  <p className="mt-1 text-xs text-neutral-500">
                    {section.status === "approved" ? "현재 이용 중인 카드가 열려 있어요." : "결제 후 해당 성별 카드가 바로 열립니다."}
                  </p>
                </div>
                <span className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-neutral-600">
                  {section.status === "approved" ? "이용 중" : section.status === "pending" ? "승인 대기" : "결제 가능"}
                </span>
              </div>

              <div className="mt-4 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => void requestCheckout(section.sex)}
                  disabled={!status.loggedIn || section.status === "approved" || submitting === section.sex}
                  className="inline-flex min-h-[42px] items-center rounded-xl bg-rose-600 px-4 text-sm font-semibold text-white hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {section.status === "approved" ? "이용 중" : submitting === section.sex ? "결제창 준비 중..." : "카카오페이로 결제"}
                </button>
                {!status.loggedIn ? <span className="text-xs text-neutral-500">로그인 후 이용 가능</span> : null}
                {!isAdmin && adminChecked ? <span className="text-xs text-neutral-500">현재는 운영 테스트 계정에서 먼저 확인 중입니다.</span> : null}
              </div>
            </div>
          ))}
        </div>
      </section>

      <DatingAdultNotice />

      {maleItems.length > 0 ? (
        <section className="mt-6">
          <div className="mb-3 flex items-end justify-between">
            <h2 className="text-xl font-black tracking-tight text-neutral-950">남자 카드 둘러보기</h2>
            <span className="text-sm text-neutral-400">{maleItems.length}명</span>
          </div>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {maleItems.map((card) => (
              <MoreViewCardTile key={`male-${card.id}`} card={card} />
            ))}
          </div>
        </section>
      ) : null}

      {femaleItems.length > 0 ? (
        <section className="mt-6">
          <div className="mb-3 flex items-end justify-between">
            <h2 className="text-xl font-black tracking-tight text-neutral-950">여자 카드 둘러보기</h2>
            <span className="text-sm text-neutral-400">{femaleItems.length}명</span>
          </div>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {femaleItems.map((card) => (
              <MoreViewCardTile key={`female-${card.id}`} card={card} />
            ))}
          </div>
        </section>
      ) : null}

      <PaidPolicyNotice />
    </main>
  );
}
