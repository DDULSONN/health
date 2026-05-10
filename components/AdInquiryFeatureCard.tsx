"use client";

import { useEffect, useState } from "react";

type AdInquirySetting = {
  enabled: boolean;
  title: string;
  description: string;
  cta: string;
  linkUrl: string;
  badge: string;
};

const FALLBACK_SETTING: AdInquirySetting = {
  enabled: false,
  title: "헬스장 로테이션 소개팅 참여하기",
  description: "배너, 제휴, 스폰서 문의는 오픈카톡으로 편하게 남겨 주세요.",
  cta: "자세히 보기",
  linkUrl: process.env.NEXT_PUBLIC_OPENKAKAO_URL ?? "https://open.kakao.com/o/s2gvTdhi",
  badge: "AD",
};

export default function AdInquiryFeatureCard() {
  const [setting, setSetting] = useState<AdInquirySetting>(FALLBACK_SETTING);

  useEffect(() => {
    let active = true;

    fetch("/api/site/ad-inquiry", { cache: "no-store" })
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

  return (
    <a
      href={setting.linkUrl}
      target={setting.linkUrl.startsWith("/") ? undefined : "_blank"}
      rel={setting.linkUrl.startsWith("/") ? undefined : "noreferrer"}
      className="group block rounded-2xl border-2 border-fuchsia-200 bg-fuchsia-50 p-5 transition-all hover:border-fuchsia-400 active:scale-[0.99]"
    >
      <div className="flex items-start gap-4">
        <span className="shrink-0 text-3xl" aria-hidden>
          AD
        </span>
        <div className="min-w-0 w-full">
          <p className="text-[11px] font-semibold tracking-[0.18em] text-fuchsia-600">{setting.badge}</p>
          <h2 className="mt-1 text-lg font-bold text-neutral-900 transition-colors group-hover:text-fuchsia-700">
            {setting.title}
          </h2>
          <p className="mt-1 text-sm leading-relaxed text-neutral-600">{setting.description}</p>
          <p className="mt-3 text-xs font-semibold text-fuchsia-700">{setting.cta}</p>
        </div>
      </div>
    </a>
  );
}
