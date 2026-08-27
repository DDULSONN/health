"use client";

import Image from "next/image";
import { useState } from "react";

export default function AdminOpenCardPreviewImage({ url, alt }: { url: string; alt: string }) {
  const [failed, setFailed] = useState(false);
  const [retryKey, setRetryKey] = useState(0);
  const source = retryKey > 0 ? `${url}${url.includes("?") ? "&" : "?"}retry=${retryKey}` : url;

  if (failed) {
    return (
      <div className="flex aspect-[3/4] flex-col items-center justify-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 text-center">
        <p className="text-[11px] font-semibold leading-5 text-amber-800">검수 사진을 불러오지 못했습니다.</p>
        <button
          type="button"
          onClick={() => {
            setRetryKey((current) => current + 1);
            setFailed(false);
          }}
          className="min-h-8 rounded-lg border border-amber-300 bg-white px-3 text-[11px] font-semibold text-amber-800"
        >
          다시 불러오기
        </button>
      </div>
    );
  }

  return (
    <a
      href={source}
      target="_blank"
      rel="noreferrer"
      className="block overflow-hidden rounded-lg border border-emerald-200 bg-neutral-100"
      aria-label={`${alt} 크게 보기`}
    >
      <Image
        src={source}
        alt={alt}
        width={720}
        height={960}
        unoptimized
        onError={() => setFailed(true)}
        className="aspect-[3/4] h-auto w-full object-contain"
      />
    </a>
  );
}
