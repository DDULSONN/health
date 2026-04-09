"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";

const STORAGE_KEY = "dating-adult-notice-dismissed:v1";
const CHANGE_EVENT = "dating-adult-notice-change";

function subscribe(onStoreChange: () => void) {
  const handleChange = () => onStoreChange();
  window.addEventListener("storage", handleChange);
  window.addEventListener(CHANGE_EVENT, handleChange);
  return () => {
    window.removeEventListener("storage", handleChange);
    window.removeEventListener(CHANGE_EVENT, handleChange);
  };
}

function getDismissedSnapshot() {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function getServerSnapshot() {
  return true;
}

export default function DatingAdultNotice() {
  const dismissed = useSyncExternalStore(subscribe, getDismissedSnapshot, getServerSnapshot);

  const handleDismiss = () => {
    try {
      window.localStorage.setItem(STORAGE_KEY, "1");
      window.dispatchEvent(new Event(CHANGE_EVENT));
    } catch {
      // ignore storage errors
    }
  };

  if (dismissed) return null;

  return (
    <section className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-amber-900">성인 이용 및 안전 안내</h2>
          <ul className="mt-2 space-y-1 text-xs leading-5 text-amber-900">
            <li>만 19세 이상 성인만 이용할 수 있습니다.</li>
            <li>허위 정보, 금전 요구, 성희롱, 불법 촬영물 공유, 서비스 목적 외 이용은 제재될 수 있습니다.</li>
            <li>문제가 생기면 신고, 차단, 마이페이지 1:1 문의로 접수해 주세요.</li>
          </ul>
          <div className="mt-3 flex flex-wrap gap-2">
            <Link href="/dating-policy" className="rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-xs font-medium text-amber-900">
              운영정책 보기
            </Link>
            <Link href="/mypage" className="rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-xs font-medium text-amber-900">
              마이페이지 문의
            </Link>
          </div>
        </div>
        <button
          type="button"
          onClick={handleDismiss}
          className="rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-xs font-medium text-amber-900"
        >
          다시 보지 않기
        </button>
      </div>
    </section>
  );
}
