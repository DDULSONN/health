"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { fetchClientJson } from "@/lib/client-json-request";

export default function LovePassLink({ placement = "inline" }: { placement?: "inline" | "open-card-home" }) {
  const [available, setAvailable] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    void fetchClientJson<{ saleAvailable: boolean }>("/api/dating/love-pass?availability=1", { cache: "no-store", signal: controller.signal })
      .then(({ response, body }) => { if (!controller.signal.aborted && response.ok && body?.saleAvailable === true) setAvailable(true); })
      .catch(() => {});
    return () => controller.abort();
  }, []);
  if (!available) return null;
  if (placement === "open-card-home") {
    return (
      <Link href="/dating/love-pass" prefetch={false} aria-label="짐툴 연애 패스 혜택 보기"
        className="mb-3 flex min-h-11 w-full items-center justify-between gap-2 rounded-xl border border-rose-200 bg-rose-50/60 px-3 py-2 text-left hover:bg-rose-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-700 sm:px-4">
        <span className="min-w-0 break-keep">
          <span className="block text-sm font-bold leading-5 text-neutral-950">짐툴 연애 패스</span>
          <span className="block text-xs leading-5 text-neutral-600">근처 대기 카드 먼저 보기</span>
        </span>
        <span className="shrink-0 whitespace-nowrap text-xs font-semibold text-rose-800" aria-hidden="true">혜택 보기 ›</span>
      </Link>
    );
  }
  return <Link href="/dating/love-pass" prefetch={false} className="inline-flex min-h-11 items-center rounded-full border border-rose-200 bg-rose-50 px-3 text-sm font-semibold text-rose-800 hover:bg-rose-100">짐툴 연애 패스</Link>;
}
