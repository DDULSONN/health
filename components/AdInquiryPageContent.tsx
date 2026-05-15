"use client";

import { useEffect, useState } from "react";

type AdInquirySetting = {
  enabled: boolean;
  title: string;
  description: string;
  cta: string;
  linkUrl: string;
  badge: string;
  theme: "emerald" | "rose" | "violet" | "sky" | "amber" | "neutral";
};

const FALLBACK_SETTING: AdInquirySetting = {
  enabled: true,
  title: "(광고) 문의 주세요",
  description: "배너, 제휴, 스폰서 문의는 오픈카톡으로 편하게 남겨 주세요.",
  cta: "오픈카톡 문의",
  linkUrl: process.env.NEXT_PUBLIC_OPENKAKAO_URL ?? "https://open.kakao.com/o/s2gvTdhi",
  badge: "AD SLOT",
  theme: "emerald",
};

const themeClass: Record<AdInquirySetting["theme"], { section: string; badge: string; button: string }> = {
  emerald: {
    section: "border-emerald-200 bg-gradient-to-br from-emerald-50 via-white to-lime-50",
    badge: "text-emerald-600",
    button: "bg-emerald-600 hover:bg-emerald-700",
  },
  rose: {
    section: "border-rose-200 bg-gradient-to-br from-rose-50 via-white to-pink-50",
    badge: "text-rose-600",
    button: "bg-rose-600 hover:bg-rose-700",
  },
  violet: {
    section: "border-violet-200 bg-gradient-to-br from-violet-50 via-white to-fuchsia-50",
    badge: "text-violet-600",
    button: "bg-violet-600 hover:bg-violet-700",
  },
  sky: {
    section: "border-sky-200 bg-gradient-to-br from-sky-50 via-white to-cyan-50",
    badge: "text-sky-600",
    button: "bg-sky-600 hover:bg-sky-700",
  },
  amber: {
    section: "border-amber-200 bg-gradient-to-br from-amber-50 via-white to-orange-50",
    badge: "text-amber-600",
    button: "bg-amber-600 hover:bg-amber-700",
  },
  neutral: {
    section: "border-neutral-200 bg-gradient-to-br from-neutral-50 via-white to-stone-50",
    badge: "text-neutral-600",
    button: "bg-neutral-900 hover:bg-neutral-800",
  },
};

export default function AdInquiryPageContent() {
  const [setting, setSetting] = useState<AdInquirySetting>(FALLBACK_SETTING);

  useEffect(() => {
    let active = true;

    fetch("/api/site/ad-inquiry")
      .then((res) => res.json())
      .then((data: Partial<AdInquirySetting>) => {
        if (!active) return;
        setSetting({
          enabled: data.enabled !== false,
          title: data.title?.trim() || FALLBACK_SETTING.title,
          description: data.description?.trim() || FALLBACK_SETTING.description,
          cta: data.cta?.trim() || FALLBACK_SETTING.cta,
          linkUrl: data.linkUrl?.trim() || FALLBACK_SETTING.linkUrl,
          badge: data.badge?.trim() || FALLBACK_SETTING.badge,
          theme: data.theme ?? FALLBACK_SETTING.theme,
        });
      })
      .catch(() => {
        if (!active) return;
        setSetting(FALLBACK_SETTING);
      });

    return () => {
      active = false;
    };
  }, []);

  const theme = themeClass[setting.theme] ?? themeClass.emerald;

  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <section className={`rounded-3xl border p-6 shadow-sm ${theme.section}`}>
        <p className={`text-xs font-semibold tracking-[0.24em] ${theme.badge}`}>{setting.badge}</p>
        <h1 className="mt-3 text-3xl font-bold text-neutral-900">{setting.title}</h1>
        <p className="mt-3 max-w-2xl text-sm leading-7 text-neutral-600">{setting.description}</p>
        <div className="mt-5 flex flex-wrap gap-3">
          <a
            href={setting.linkUrl}
            target="_blank"
            rel="noreferrer"
            className={`inline-flex h-11 items-center rounded-xl px-5 text-sm font-semibold text-white transition ${theme.button}`}
          >
            {setting.cta}
          </a>
        </div>
      </section>

      <section className="mt-6 rounded-3xl border border-dashed border-neutral-300 bg-white p-6">
        <h2 className="text-lg font-semibold text-neutral-900">광고 슬롯 안내</h2>
        <p className="mt-2 text-sm leading-7 text-neutral-600">
          홈 카드, 상단 진입 링크, 이벤트 배너처럼 확장 가능한 광고 문의 자리입니다. 관리자 마이페이지에서 문구와
          링크를 바로 바꿀 수 있게 연결해 두었습니다.
        </p>
      </section>
    </main>
  );
}
