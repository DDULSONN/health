"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { isSiteAnnouncementActive, SITE_ANNOUNCEMENT } from "@/lib/site-announcement";
import FriendRecommendationNotice from "@/components/dating/sharing/FriendRecommendationNotice";

const STORAGE_KEY = `site-announcement:${SITE_ANNOUNCEMENT.id}`;
// Site-wide notice, but never interrupt authentication, verification, checkout
// or an in-progress profile/application form. Keep the same acknowledgement ID.
const EXCLUDED_PATH_PREFIXES = [
  "/api", "/admin", "/mypage/admin", "/payments", "/auth", "/login", "/signup",
  "/account-recovery", "/phone-verification", "/verify-email", "/onboarding",
  "/community/write", "/s",
];

let acknowledgedInMemory = false;

function isVisiblePath(pathname: string) {
  return !EXCLUDED_PATH_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))
    && !/\/(?:new|edit|apply)\/?$/.test(pathname);
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
  const router = useRouter();
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

  return <FriendRecommendationNotice
    onClose={close}
    onExplore={() => { close(); router.push("/community/dating/cards"); }}
    onSettings={() => { close(); router.push("/mypage?section=settings"); }}
  />;
}
