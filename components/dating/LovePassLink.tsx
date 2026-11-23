"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { fetchClientJson } from "@/lib/client-json-request";

export default function LovePassLink() {
  const [available, setAvailable] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    void fetchClientJson<{ saleAvailable: boolean }>("/api/dating/love-pass?availability=1", { cache: "no-store", signal: controller.signal })
      .then(({ response, body }) => { if (!controller.signal.aborted && response.ok && body?.saleAvailable === true) setAvailable(true); })
      .catch(() => {});
    return () => controller.abort();
  }, []);
  return available ? <Link href="/dating/love-pass" prefetch={false} className="inline-flex min-h-11 items-center rounded-full border border-rose-200 bg-rose-50 px-3 text-sm font-semibold text-rose-800 hover:bg-rose-100">짐툴 연애 패스</Link> : null;
}
