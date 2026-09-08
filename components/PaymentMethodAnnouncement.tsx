"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

const ANNOUNCEMENT_ID = "one-on-one-refresh-fixed-2026-09-08";
const STORAGE_KEY = `site-announcement:${ANNOUNCEMENT_ID}`;
const VISIBLE_PATH_PREFIXES = [
  "/community/dating",
  "/dating/",
  "/mypage",
];

let acknowledgedInMemory = false;

function isVisiblePath(pathname: string) {
  return VISIBLE_PATH_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(prefix));
}

function hasAcknowledged() {
  if (acknowledgedInMemory) return true;
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function saveAcknowledgement() {
  acknowledgedInMemory = true;
  try {
    window.localStorage.setItem(STORAGE_KEY, "1");
  } catch {
    // The in-memory flag still prevents repeated display during this visit.
  }
}

export default function PaymentMethodAnnouncement() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!isVisiblePath(pathname) || hasAcknowledged()) return;

    const timer = window.setTimeout(() => setOpen(true), 450);
    return () => window.clearTimeout(timer);
  }, [pathname]);

  const close = () => {
    saveAcknowledgement();
    setOpen(false);
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/45 px-5 py-8">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="site-announcement-title"
        className="w-full max-w-sm rounded-lg border border-neutral-200 bg-white p-5 shadow-2xl"
      >
        <p className="text-xs font-semibold text-rose-600">새 소식</p>
        <h2 id="site-announcement-title" className="mt-2 text-xl font-bold text-neutral-950">
          1:1 후보 새로고침 개선
        </h2>
        <p className="mt-3 text-sm leading-6 text-neutral-600">
          후보를 새로고침해도 같은 사람이 반복되던 문제를 수정했습니다.
        </p>
        <button
          type="button"
          onClick={close}
          className="mt-5 min-h-12 w-full rounded-lg bg-neutral-950 px-4 text-sm font-semibold text-white transition-colors hover:bg-neutral-800 active:bg-neutral-700"
        >
          확인
        </button>
      </section>
    </div>
  );
}
