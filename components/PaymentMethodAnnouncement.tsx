"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

const ANNOUNCEMENT_ID = "payment-methods-expanded-2026-08-09";
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
        aria-labelledby="payment-method-announcement-title"
        className="w-full max-w-sm rounded-lg border border-neutral-200 bg-white p-5 shadow-2xl"
      >
        <p className="text-xs font-semibold text-rose-600">새 소식</p>
        <h2 id="payment-method-announcement-title" className="mt-2 text-xl font-bold text-neutral-950">
          결제수단이 더 다양해졌어요
        </h2>
        <p className="mt-3 text-sm leading-6 text-neutral-600">
          이제 결제창에서 이용 가능한 카드와 간편결제 수단을 직접 선택할 수 있어요.
        </p>
        <p className="mt-2 text-xs leading-5 text-neutral-500">
          국민·우리·현대카드는 현재 이용이 어려울 수 있습니다.
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
