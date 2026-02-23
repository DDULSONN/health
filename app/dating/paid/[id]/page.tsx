"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { formatRemainingToKorean } from "@/lib/dating-open";

type PaidCardDetail = {
  id: string;
  nickname: string;
  gender: "M" | "F";
  age: number | null;
  region: string | null;
  height_cm: number | null;
  job: string | null;
  training_years: number | null;
  strengths_text: string | null;
  ideal_text: string | null;
  intro_text: string | null;
  expires_at: string;
  image_urls: string[];
  photo_visibility: "blur" | "public";
};

type PaidListItem = {
  id: string;
  thumbUrl: string;
};

export default function PaidCardDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const [card, setCard] = useState<PaidCardDetail | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    queueMicrotask(async () => {
      try {
        const res = await fetch(`/api/dating/paid/${id}`, { cache: "no-store" });
        if (!res.ok) {
          router.replace("/dating/paid");
          return;
        }
        const body = (await res.json().catch(() => ({}))) as { card?: PaidCardDetail };
        if (!body.card) {
          router.replace("/dating/paid");
          return;
        }

        let nextCard = body.card;
        if (!Array.isArray(nextCard.image_urls) || nextCard.image_urls.length === 0) {
          try {
            const listRes = await fetch("/api/dating/paid/list", { cache: "no-store" });
            if (listRes.ok) {
              const listBody = (await listRes.json().catch(() => ({}))) as { items?: PaidListItem[] };
              const matched = Array.isArray(listBody.items) ? listBody.items.find((item) => item.id === id) : undefined;
              if (matched?.thumbUrl) {
                nextCard = { ...nextCard, image_urls: [matched.thumbUrl] };
              }
            }
          } catch {
            // keep original card when list fallback fails
          }
        }

        setCard(nextCard);
      } catch {
        router.replace("/dating/paid");
      } finally {
        setLoading(false);
      }
    });
  }, [id, router]);

  if (loading) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-8">
        <p className="text-sm text-neutral-500">불러오는 중...</p>
      </main>
    );
  }

  if (!card) return null;

  return (
    <main className="mx-auto max-w-2xl px-4 py-8">
      <Link href="/dating/paid" className="text-sm text-neutral-500 hover:text-neutral-700">
        목록으로
      </Link>

      <section className="mt-3 rounded-2xl border border-neutral-200 bg-white p-4">
        <div className="flex items-center justify-between gap-2">
          <h1 className="text-xl font-bold text-neutral-900">{card.nickname}</h1>
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">
            {formatRemainingToKorean(card.expires_at)}
          </span>
        </div>

        {card.image_urls.length > 0 ? (
          <div
            className={`mt-3 overflow-hidden rounded-xl border border-neutral-100 bg-neutral-50 ${
              card.image_urls.length >= 2 ? "grid grid-cols-2 gap-1" : ""
            }`}
          >
            {card.image_urls.map((url, idx) => (
              <div key={`${card.id}-${idx}`} className="flex h-56 w-full items-center justify-center bg-neutral-50 md:h-64">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={url}
                  alt=""
                  className={`max-h-full max-w-full h-auto w-auto object-contain object-center ${card.photo_visibility === "public" ? "" : "blur-[9px]"}`}
                />
              </div>
            ))}
          </div>
        ) : null}

        <div className="mt-3 flex flex-wrap gap-2 text-xs text-neutral-600">
          {card.gender && <span>{card.gender}</span>}
          {card.age != null && <span>{card.age}세</span>}
          {card.region && <span>{card.region}</span>}
          {card.height_cm != null && <span>{card.height_cm}cm</span>}
          {card.job && <span>{card.job}</span>}
          {card.training_years != null && <span>운동 {card.training_years}년</span>}
        </div>

        {card.strengths_text ? (
          <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-3">
            <p className="text-sm font-semibold text-emerald-800">내 장점</p>
            <p className="mt-1 whitespace-pre-wrap break-words text-sm text-emerald-900">{card.strengths_text}</p>
          </div>
        ) : null}

        {card.ideal_text ? (
          <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 p-3">
            <p className="text-sm font-semibold text-rose-800">💘 이상형</p>
            <p className="mt-1 whitespace-pre-wrap break-words text-sm text-rose-900">{card.ideal_text}</p>
          </div>
        ) : null}

        {card.intro_text ? (
          <div className="mt-3 rounded-xl border border-neutral-200 bg-neutral-50 p-3">
            <p className="text-sm font-semibold text-neutral-700">자기소개</p>
            <p className="mt-1 whitespace-pre-wrap break-words text-sm text-neutral-800">{card.intro_text}</p>
          </div>
        ) : null}

        <div className="mt-4">
          <Link
            href={`/dating/paid/${card.id}/apply`}
            className="inline-flex min-h-[42px] items-center rounded-lg bg-pink-500 px-4 text-sm font-medium text-white hover:bg-pink-600"
          >
            지원하기
          </Link>
        </div>
      </section>
    </main>
  );
}

