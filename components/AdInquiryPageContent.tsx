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
  enabled: true,
  title: "(광고) 문의 주세요",
  description: "배너, 제휴, 스폰서 문의는 오픈카톡으로 편하게 남겨 주세요.",
  cta: "오픈카톡 문의",
  linkUrl: process.env.NEXT_PUBLIC_OPENKAKAO_URL ?? "https://open.kakao.com/o/s2gvTdhi",
  badge: "AD SLOT",
};

export default function AdInquiryPageContent() {
  const [setting, setSetting] = useState<AdInquirySetting>(FALLBACK_SETTING);

  useEffect(() => {
    let active = true;

    fetch("/api/site/ad-inquiry", { cache: "no-store" })
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

  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <section className="rounded-3xl border border-fuchsia-200 bg-gradient-to-br from-fuchsia-50 via-white to-amber-50 p-6 shadow-sm">
        <p className="text-xs font-semibold tracking-[0.24em] text-fuchsia-600">{setting.badge}</p>
        <h1 className="mt-3 text-3xl font-bold text-neutral-900">{setting.title}</h1>
        <p className="mt-3 max-w-2xl text-sm leading-7 text-neutral-600">{setting.description}</p>
        <div className="mt-5 flex flex-wrap gap-3">
          <a
            href={setting.linkUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-11 items-center rounded-xl bg-fuchsia-600 px-5 text-sm font-semibold text-white transition hover:bg-fuchsia-700"
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
