"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { formatRemainingToKorean } from "@/lib/dating-open";
import DatingReportButton from "@/components/DatingReportButton";
import PhoneVerifiedBadge from "@/components/PhoneVerifiedBadge";
import { removeOpenCardDetail } from "@/lib/dating-detail-cache";
import { datingAuthSessionMissing } from "@/lib/dating-read-recovery";
import { fetchClientJson } from "@/lib/client-json-request";
import { createClient } from "@/lib/supabase/client";

type CardDetail = {
  id: string;
  sex: "male" | "female";
  display_nickname: string;
  is_phone_verified?: boolean;
  age: number | null;
  region: string | null;
  height_cm: number | null;
  job: string | null;
  training_years: number | null;
  ideal_type: string | null;
  strengths_text: string | null;
  photo_visibility: "blur" | "public";
  total_3lift: number | null;
  is_3lift_verified: boolean;
  image_urls: string[];
  expires_at: string | null;
  owner_user_id?: string;
};

function isGoldLiftCard(card: Pick<CardDetail, "sex" | "total_3lift" | "is_3lift_verified">) {
  if (!card.is_3lift_verified || card.total_3lift == null) return false;
  return (card.sex === "male" && card.total_3lift >= 500) || (card.sex === "female" && card.total_3lift >= 300);
}

export default function OpenCardDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const fromNearby = searchParams.get("from") === "nearby";
  const fromLovePass = searchParams.get("from") === "love-pass";
  const listHref = fromLovePass ? "/dating/love-pass" : fromNearby ? "/dating/nearby-view" : "/community/dating/cards";
  const sourceQuery = fromLovePass ? "?from=love-pass" : fromNearby ? "?from=nearby" : "";
  const detailHref = `/community/dating/cards/${id}${sourceQuery}`;
  const supabase = useMemo(() => createClient(), []);
  const [view, setView] = useState<{ href: string; attempt: number; card?: CardDetail; message?: string; retry?: boolean } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const currentView = view?.href === detailHref && view.attempt === attempt ? view : null;
  const card = currentView?.card;

  useEffect(() => {
    const controller = new AbortController();
    const login = () => router.replace(`/login?redirect=${encodeURIComponent(detailHref)}`);
    const unavailable = () => setView({ href: detailHref, attempt, message: "지금은 볼 수 없는 카드예요." });
    void (async () => {
      try {
        const { data: { user }, error } = await supabase.auth.getUser();
        if (controller.signal.aborted) return;
        if (error && !datingAuthSessionMissing(error)) throw error;
        if (!user) {
          login();
          return;
        }
        const { response, body } = await fetchClientJson<{ card?: CardDetail }>(`/api/dating/cards/${id}`, { cache: "no-store", signal: controller.signal });
        if (controller.signal.aborted) return;
        if (response.status === 401) {
          login();
          return;
        }
        if (response.status === 403 || response.status === 404 || response.status === 410) {
          unavailable();
          return;
        }
        if (!response.ok || body?.card?.id !== id || !Array.isArray(body.card.image_urls)) throw new Error("card_detail_read_failed");
        setView({ href: detailHref, attempt, card: body.card });
      } catch {
        if (!controller.signal.aborted) setView({ href: detailHref, attempt, message: "카드를 잠시 불러오지 못했어요.", retry: true });
      }
    })();
    return () => controller.abort();
  }, [attempt, detailHref, id, router, supabase]);

  if (!currentView) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-8">
        <DetailSkeleton />
      </main>
    );
  }

  if (!card) return (
    <main className="mx-auto max-w-2xl px-4 py-8">
      <div role="status" className="rounded-2xl border border-neutral-200 bg-white p-5 text-sm text-neutral-700">
        <p>{currentView.message}</p>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          {currentView.retry ? <button type="button" onClick={() => setAttempt(value => value + 1)} className="min-h-11 rounded-xl border border-neutral-300 px-3 font-semibold">다시 불러오기</button> : null}
          <Link href={listHref} className="inline-flex min-h-11 items-center underline underline-offset-2">목록으로</Link>
        </div>
      </div>
    </main>
  );


  return (
    <main className="mx-auto max-w-2xl px-4 py-8">
      <Link href={listHref} className="text-sm text-neutral-500 hover:text-neutral-700 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-900">
        뒤로가기
      </Link>

      <div
        className={`mt-4 rounded-2xl border bg-white p-5 ${
          isGoldLiftCard(card)
            ? "border-amber-300 shadow-[0_0_0_1px_rgba(251,191,36,0.35),0_14px_34px_rgba(180,83,9,0.10)]"
            : "border-neutral-200"
        }`}
      >
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold text-neutral-900">{card.display_nickname}</h1>
            <PhoneVerifiedBadge verified={card.is_phone_verified} />
          </div>
          <span className="inline-flex rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">
            {card.expires_at ? `잔여 ${formatRemainingToKorean(card.expires_at)}` : "대기열"}
          </span>
        </div>

        <div
          className={`mt-3 overflow-hidden rounded-xl border border-neutral-100 bg-neutral-50 ${
            card.image_urls.length >= 2 ? "grid grid-cols-2 gap-1" : ""
          }`}
        >
          {card.image_urls.length > 0 ? (
            card.image_urls.map((url, idx) => (
              <OpenCardPhoto key={`${card.id}-${idx}-${url}`} url={url} blur={card.photo_visibility !== "public"} />
            ))
          ) : (
            <div className="flex h-52 items-center justify-center bg-neutral-100 text-sm text-neutral-500 md:h-56">표시할 사진이 없어요.</div>
          )}
        </div>

        <div className="mt-3 flex flex-wrap gap-2 text-xs text-neutral-600">
          {card.age != null && <span>나이 {card.age}세</span>}
          {card.region && <span>지역 {card.region}</span>}
          {card.height_cm != null && <span>키 {card.height_cm}cm</span>}
          {card.job && <span>직업 {card.job}</span>}
          {card.training_years != null && <span>운동 {card.training_years}년</span>}
          {card.is_3lift_verified && (
            <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700">3대인증 완료</span>
          )}
        </div>

        {card.total_3lift != null ? (
          <div className="mt-2 flex flex-wrap gap-2">
            <span className="rounded-full bg-rose-100 px-2 py-0.5 text-xs font-medium text-rose-700">3대 {card.total_3lift}kg</span>
          </div>
        ) : null}

        {card.ideal_type ? (
          <div className="mt-4 rounded-xl border border-pink-100 bg-pink-50 p-3">
            <p className="text-sm font-semibold text-pink-700">이상형</p>
            <p className="mt-1 whitespace-pre-wrap break-words text-sm text-neutral-700">{card.ideal_type}</p>
          </div>
        ) : null}

        {card.strengths_text ? (
          <div className="mt-3 rounded-xl border border-emerald-100 bg-emerald-50 p-3">
            <p className="text-sm font-semibold text-emerald-700">내 장점</p>
            <p className="mt-1 whitespace-pre-wrap break-words text-sm text-neutral-700">{card.strengths_text}</p>
          </div>
        ) : null}

        <div className="mt-4">
          <div className="flex flex-wrap gap-2">
            <Link
              href={`/community/dating/cards/${card.id}/apply${sourceQuery}`}
              className="inline-flex min-h-[44px] items-center rounded-xl bg-[#f0003d] px-4 text-sm font-medium text-white hover:bg-[#d90037] transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-900"
            >
              지원하기
            </Link>
            <DatingReportButton targetType="open_card" targetId={card.id} label={card.display_nickname}
              onReported={(result) => {
                if (result.blocked) {
                  removeOpenCardDetail(card.id);
                  router.replace(listHref);
                }
              }} />
          </div>
        </div>
      </div>

    </main>
  );
}

function OpenCardPhoto({ url, blur }: { url: string; blur: boolean }) {
  const [failed, setFailed] = useState(false);
  return (
    <div className="flex h-52 items-center justify-center bg-neutral-50 md:h-56">
      {failed ? <span className="text-xs text-neutral-500">사진을 불러오지 못했어요.</span> : (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt="" decoding="async" onError={() => setFailed(true)} className={`h-auto max-h-full w-auto max-w-full object-contain object-center${blur ? " blur-[9px]" : ""}`} />
      )}
    </div>
  );
}

function DetailSkeleton() {
  return (
    <div className="mt-4 animate-pulse rounded-2xl border border-neutral-200 bg-white p-5">
      <div className="h-5 w-32 rounded bg-neutral-200" />
      <div className="mt-3 h-52 rounded-xl bg-neutral-100 md:h-56" />
      <div className="mt-3 flex flex-wrap gap-2">
        <div className="h-5 w-16 rounded-full bg-neutral-100" />
        <div className="h-5 w-20 rounded-full bg-neutral-100" />
        <div className="h-5 w-24 rounded-full bg-neutral-100" />
      </div>
      <div className="mt-4 h-20 rounded-xl bg-neutral-50" />
      <div className="mt-3 h-16 rounded-xl bg-neutral-50" />
    </div>
  );
}
