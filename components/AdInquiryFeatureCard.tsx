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
  enabled: false,
  title: "헬스장 로테이션 소개팅 참여하기",
  description: "배너, 제휴, 스폰서 문의는 오픈카톡으로 편하게 남겨 주세요.",
  cta: "자세히 보기",
  linkUrl: process.env.NEXT_PUBLIC_OPENKAKAO_URL ?? "https://open.kakao.com/o/s2gvTdhi",
  badge: "AD",
  theme: "emerald",
};

const themeClass: Record<AdInquirySetting["theme"], { wrap: string; badge: string; title: string; cta: string }> = {
  emerald: {
    wrap: "border-emerald-200 bg-emerald-50 hover:border-emerald-400",
    badge: "text-emerald-600",
    title: "group-hover:text-emerald-700",
    cta: "text-emerald-700",
  },
  rose: {
    wrap: "border-rose-200 bg-rose-50 hover:border-rose-400",
    badge: "text-rose-600",
    title: "group-hover:text-rose-700",
    cta: "text-rose-700",
  },
  violet: {
    wrap: "border-violet-200 bg-violet-50 hover:border-violet-400",
    badge: "text-violet-600",
    title: "group-hover:text-violet-700",
    cta: "text-violet-700",
  },
  sky: {
    wrap: "border-sky-200 bg-sky-50 hover:border-sky-400",
    badge: "text-sky-600",
    title: "group-hover:text-sky-700",
    cta: "text-sky-700",
  },
  amber: {
    wrap: "border-amber-200 bg-amber-50 hover:border-amber-400",
    badge: "text-amber-600",
    title: "group-hover:text-amber-700",
    cta: "text-amber-700",
  },
  neutral: {
    wrap: "border-neutral-200 bg-neutral-50 hover:border-neutral-400",
    badge: "text-neutral-600",
    title: "group-hover:text-neutral-800",
    cta: "text-neutral-700",
  },
};

export default function AdInquiryFeatureCard() {
  const [setting, setSetting] = useState<AdInquirySetting>(FALLBACK_SETTING);

  useEffect(() => {
    let active = true;

    fetch("/api/site/ad-inquiry")
      .then((res) => res.json())
      .then((data: Partial<AdInquirySetting>) => {
        if (!active) return;
        setSetting({
          enabled: data.enabled === true,
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

  if (!setting.enabled) return null;
  const theme = themeClass[setting.theme] ?? themeClass.emerald;

  return (
    <a
      href={setting.linkUrl}
      target={setting.linkUrl.startsWith("/") ? undefined : "_blank"}
      rel={setting.linkUrl.startsWith("/") ? undefined : "noreferrer"}
      className={`group block rounded-2xl border-2 p-5 transition-all active:scale-[0.99] ${theme.wrap}`}
    >
      <div className="flex items-start gap-4">
        <span className="shrink-0 text-3xl" aria-hidden>
          AD
        </span>
        <div className="min-w-0 w-full">
          <p className={`text-[11px] font-semibold tracking-[0.18em] ${theme.badge}`}>{setting.badge}</p>
          <h2 className={`mt-1 text-lg font-bold text-neutral-900 transition-colors ${theme.title}`}>
            {setting.title}
          </h2>
          <p className="mt-1 text-sm leading-relaxed text-neutral-600">{setting.description}</p>
          <p className={`mt-3 text-xs font-semibold ${theme.cta}`}>{setting.cta}</p>
        </div>
      </div>
    </a>
  );
}
