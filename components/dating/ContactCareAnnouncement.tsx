"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { fetchClientJson } from "@/lib/client-json-request";
import { CONTACT_CARE_HREF, CONTACT_CARE_NOTICE_ID, CONTACT_CARE_NOTICE_MESSAGE, CONTACT_CARE_NOTICE_TITLE,
  contactCareNoticePathAllowed, isContactCareNoticeActive, type ContactCarePublicPolicy } from "@/lib/contact-care-notice";

const key = `site-announcement:${CONTACT_CARE_NOTICE_ID}`;
let dismissed = false;
// Only public policy metadata is cached; never share member data across instances.
let cached: { until: number; result: Promise<ContactCarePublicPolicy | null> } | null = null;
function acknowledged() {
  if (dismissed) return true;
  try { return localStorage.getItem(key) === "1"; } catch { return false; }
}
function loadPolicy() {
  if (cached && cached.until > Date.now()) return cached.result;
  const result = fetchClientJson<ContactCarePublicPolicy>("/api/dating/1on1/contact-care/policy", {}, 6000)
    .then(({ response, body }) => response.ok ? body : null).catch(() => null);
  cached = { until: Date.now() + 60000, result };
  return result;
}

export default function ContactCareAnnouncement() {
  const pathname = usePathname() || "/";
  const dialog = useRef<HTMLDialogElement>(null);
  const [policy, setPolicy] = useState<ContactCarePublicPolicy | null>(null);
  useEffect(() => {
    let alive = true;
    if (!contactCareNoticePathAllowed(pathname) || acknowledged()) return;
    void loadPolicy().then(value => { if (alive) setPolicy(value); });
    return () => { alive = false; };
  }, [pathname]);
  useEffect(() => {
    const element = dialog.current;
    if (!element || !contactCareNoticePathAllowed(pathname) || !isContactCareNoticeActive(policy) || acknowledged()) {
      element?.close(); return;
    }
    const check = () => { if (!isContactCareNoticeActive(policy) || acknowledged()) element.close(); };
    const show = window.setTimeout(() => { if (isContactCareNoticeActive(policy) && !acknowledged() && !element.open) element.showModal(); }, 500);
    const expiry = window.setTimeout(() => element.close(), Date.parse(policy!.endsAt!) - Date.now());
    window.addEventListener("storage", check);
    document.addEventListener("visibilitychange", check);
    return () => { clearTimeout(show); clearTimeout(expiry); window.removeEventListener("storage", check); document.removeEventListener("visibilitychange", check); element.close(); };
  }, [pathname, policy]);
  const close = () => {
    dismissed = true;
    try { localStorage.setItem(key, "1"); } catch { /* Keep this visit dismissed. */ }
    dialog.current?.close();
  };
  return <dialog ref={dialog} onCancel={close} aria-labelledby="contact-care-notice-title"
    className="m-auto w-[calc(100%_-_2.5rem)] max-w-sm rounded-xl border border-neutral-200 bg-white p-5 text-neutral-900 shadow-xl backdrop:bg-black/45">
    <p className="text-xs font-medium text-neutral-500">이용 안내</p>
    <h2 id="contact-care-notice-title" className="mt-2 text-lg font-bold">{CONTACT_CARE_NOTICE_TITLE}</h2>
    <p className="mt-3 text-sm leading-6">{CONTACT_CARE_NOTICE_MESSAGE}</p>
    <p className="mt-2 text-xs leading-5 text-neutral-500">시행 이후 웹 결제자 대상 · 계정당 1회<br />첫 연락 후 24시간 이상 무응답 시 신청 · 관리자 승인 후 지급</p>
    <div className="mt-4 flex gap-2">
      <button type="button" onClick={close} className="min-h-11 flex-1 rounded-lg border border-neutral-200 px-3 text-sm">확인</button>
      <a href={CONTACT_CARE_HREF} onClick={close} className="flex min-h-11 flex-1 items-center justify-center rounded-lg bg-neutral-950 px-3 text-sm font-semibold text-white">자세히 보기</a>
    </div>
  </dialog>;
}
