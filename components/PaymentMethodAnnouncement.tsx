"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { isSiteAnnouncementActive, SITE_ANNOUNCEMENT } from "@/lib/site-announcement";

const STORAGE_KEY = `site-announcement:${SITE_ANNOUNCEMENT.id}`;
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

    const now = Date.now();
    const remainingMs = Date.parse(SITE_ANNOUNCEMENT.endsAt) - now;
    if (remainingMs <= 0) return;

    const showTimer = window.setTimeout(() => {
      if (isSiteAnnouncementActive() && !hasAcknowledged()) setOpen(true);
    }, Math.max(450, Date.parse(SITE_ANNOUNCEMENT.startsAt) - now));
    // Close even when the page stays open across the expiry time.
    const expiryTimer = window.setTimeout(() => setOpen(false), remainingMs);
    const checkVisibility = () => {
      if (!isSiteAnnouncementActive() || hasAcknowledged()) setOpen(false);
    };
    document.addEventListener("visibilitychange", checkVisibility);
    window.addEventListener("storage", checkVisibility);
    return () => {
      window.clearTimeout(showTimer);
      window.clearTimeout(expiryTimer);
      document.removeEventListener("visibilitychange", checkVisibility);
      window.removeEventListener("storage", checkVisibility);
    };
  }, [pathname]);

  const close = () => {
    saveAcknowledgement();
    setOpen(false);
  };

  if (!open || !isVisiblePath(pathname) || !isSiteAnnouncementActive()) return null;

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
          {SITE_ANNOUNCEMENT.title}
        </h2>
        <p className="mt-3 text-sm leading-6 text-neutral-600">
          {SITE_ANNOUNCEMENT.message}
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
