"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { formatRemainingToKorean } from "@/lib/dating-open";
import { DATING_CARD_REPORT_REASON_OPTIONS, type DatingCardReportReasonCode } from "@/lib/dating-report-reasons";
import PhoneVerifiedBadge from "@/components/PhoneVerifiedBadge";
import { readOpenCardDetail } from "@/lib/dating-detail-cache";
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

export default function OpenCardDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const [card, setCard] = useState<CardDetail | null>(() => readOpenCardDetail<CardDetail>(id));
  const [loading, setLoading] = useState(() => !readOpenCardDetail<CardDetail>(id));
  const [reportOpen, setReportOpen] = useState(false);
  const [reportReasonCode, setReportReasonCode] = useState<DatingCardReportReasonCode>("fake_profile");
  const [reportDetail, setReportDetail] = useState("");
  const [reportSubmitting, setReportSubmitting] = useState(false);
  const [reportMessage, setReportMessage] = useState("");

  useEffect(() => {
    queueMicrotask(async () => {
      try {
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!user) {
          router.replace(`/login?redirect=${encodeURIComponent(`/community/dating/cards/${id}`)}`);
          return;
        }
        const res = await fetch(`/api/dating/cards/${id}`);
        if (!res.ok) {
          if (res.status === 401) {
            router.replace(`/login?redirect=${encodeURIComponent(`/community/dating/cards/${id}`)}`);
            return;
          }
          router.replace("/community/dating/cards");
          return;
        }
        const data = (await res.json()) as { card?: CardDetail };
        if (!data.card) {
          router.replace("/community/dating/cards");
          return;
        }
        setCard(data.card);
      } catch {
        router.replace("/community/dating/cards");
      }
      setLoading(false);
    });
  }, [id, router, supabase]);

  if (loading && !card) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-8">
        <DetailSkeleton />
      </main>
    );
  }

  if (!card) return null;

  async function submitReport() {
    if (reportSubmitting) return;
    if (!card) return;

    const targetCardId = card.id;
    setReportSubmitting(true);
    setReportMessage("");
    try {
      const res = await fetch("/api/dating/cards/report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          card_id: targetCardId,
          reason_code: reportReasonCode,
          detail: reportDetail.trim(),
        }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        throw new Error(body.error ?? "신고 접수에 실패했습니다.");
      }
      setReportMessage("신고가 접수되었습니다. 운영자가 확인 후 조치합니다.");
      setReportOpen(false);
      setReportDetail("");
    } catch (error) {
      setReportMessage(error instanceof Error ? error.message : "신고 접수에 실패했습니다.");
    } finally {
      setReportSubmitting(false);
    }
  }

  return (
    <main className="mx-auto max-w-2xl px-4 py-8">
      <Link href="/community/dating/cards" className="text-sm text-neutral-500 hover:text-neutral-700">
        뒤로가기
      </Link>

      <div className="mt-4 rounded-2xl border border-neutral-200 bg-white p-5">
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
              <div key={`${card.id}-${idx}`} className="flex h-52 w-full items-center justify-center bg-neutral-50 md:h-56">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={url}
                  alt=""
                  decoding="async"
                  className={`h-auto max-h-full w-auto max-w-full object-contain object-center ${
                    card.photo_visibility === "public" ? "" : "blur-[9px]"
                  }`}
                />
              </div>
            ))
          ) : (
            <div className="h-52 w-full animate-pulse bg-neutral-100 md:h-56" />
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

        {card.sex === "male" && card.total_3lift != null ? (
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
              href={`/community/dating/cards/${card.id}/apply`}
              className="inline-flex min-h-[44px] items-center rounded-lg bg-pink-500 px-4 text-sm font-medium text-white hover:bg-pink-600"
            >
              지원하기
            </Link>
            <button
              type="button"
              onClick={() => {
                setReportMessage("");
                setReportOpen(true);
              }}
              className="inline-flex min-h-[44px] items-center rounded-lg border border-rose-200 bg-rose-50 px-4 text-sm font-medium text-rose-700 hover:bg-rose-100"
            >
              신고
            </button>
          </div>
          {reportMessage ? <p className="mt-3 text-sm text-rose-700">{reportMessage}</p> : null}
        </div>
      </div>

      {reportOpen ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 px-4 py-6 sm:items-center">
          <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl">
            <h2 className="text-lg font-bold text-neutral-900">오픈카드 신고</h2>
            <p className="mt-1 text-sm text-neutral-500">가장 가까운 사유를 하나 선택해 주세요.</p>
            <div className="mt-4 space-y-2">
              {DATING_CARD_REPORT_REASON_OPTIONS.map((option) => (
                <label
                  key={option.code}
                  className={`flex cursor-pointer items-center gap-3 rounded-xl border px-3 py-3 text-sm ${
                    reportReasonCode === option.code
                      ? "border-rose-300 bg-rose-50 text-rose-700"
                      : "border-neutral-200 bg-white text-neutral-700"
                  }`}
                >
                  <input
                    type="radio"
                    name="dating-card-report-reason"
                    checked={reportReasonCode === option.code}
                    onChange={() => setReportReasonCode(option.code)}
                  />
                  <span>{option.label}</span>
                </label>
              ))}
            </div>
            <textarea
              value={reportDetail}
              onChange={(e) => setReportDetail(e.target.value)}
              maxLength={500}
              rows={4}
              placeholder="상세 설명이 있으면 적어 주세요. (선택)"
              className="mt-4 w-full rounded-xl border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-rose-300"
            />
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={() => setReportOpen(false)}
                className="inline-flex min-h-[44px] flex-1 items-center justify-center rounded-xl border border-neutral-300 bg-white text-sm font-medium text-neutral-700"
              >
                닫기
              </button>
              <button
                type="button"
                onClick={() => void submitReport()}
                disabled={reportSubmitting}
                className="inline-flex min-h-[44px] flex-1 items-center justify-center rounded-xl bg-rose-600 text-sm font-medium text-white disabled:opacity-50"
              >
                {reportSubmitting ? "접수 중..." : "신고 접수"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
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
