"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

const GUEST_STORAGE_KEY = "dating-adult-confirmed:v2";

type AdultConfirmationState = {
  authenticated: boolean;
  confirmed: boolean;
};

function readGuestConfirmation() {
  try {
    return window.localStorage.getItem(GUEST_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function writeGuestConfirmation() {
  try {
    window.localStorage.setItem(GUEST_STORAGE_KEY, "1");
  } catch {
    // ignore storage errors
  }
}

export default function DatingAdultNotice() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;

    queueMicrotask(async () => {
      const guestConfirmed = typeof window !== "undefined" ? readGuestConfirmation() : false;

      try {
        const res = await fetch("/api/mypage/dating-adult-confirmation", { cache: "no-store" });
        const body = (await res.json().catch(() => ({}))) as Partial<AdultConfirmationState>;
        if (cancelled) return;

        const isAuthenticated = body.authenticated === true;
        const isConfirmed = body.confirmed === true;
        setAuthenticated(isAuthenticated);
        setOpen(!(isAuthenticated ? isConfirmed : guestConfirmed));
      } catch {
        if (cancelled) return;
        setAuthenticated(false);
        setOpen(!guestConfirmed);
      } finally {
        if (!cancelled) {
          setReady(true);
        }
      }
    });

    return () => {
      cancelled = true;
    };
  }, []);

  const handleConfirm = async () => {
    if (submitting) return;
    setSubmitting(true);
    try {
      if (authenticated) {
        await fetch("/api/mypage/dating-adult-confirmation", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
        });
      }
      writeGuestConfirmation();
      setOpen(false);
    } finally {
      setSubmitting(false);
    }
  };

  const handleLeave = () => {
    router.push("/");
  };

  if (!ready || !open) return null;

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/55 px-4 py-6">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="dating-adult-modal-title"
        className="w-full max-w-lg rounded-3xl border border-amber-200 bg-white p-5 shadow-2xl"
      >
        <div className="inline-flex rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-800">
          소개팅 이용 안내
        </div>
        <h2 id="dating-adult-modal-title" className="mt-3 text-xl font-bold text-neutral-900">
          만 19세 이상만 이용할 수 있습니다
        </h2>
        <p className="mt-2 text-sm leading-6 text-neutral-700">
          짐툴 소개팅은 운동 기반의 건전한 만남을 위한 서비스입니다. 첫 이용 전에 성인 이용 제한과 운영 원칙을
          확인해 주세요.
        </p>

        <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-4">
          <ul className="space-y-2 text-sm leading-6 text-amber-950">
            <li>만 19세 이상 성인만 이용 가능합니다.</li>
            <li>허위 정보, 금전 요구, 불법 촬영물 공유, 성적 목적 악용은 즉시 제한됩니다.</li>
            <li>신고, 차단, 1:1 문의, 관리자 검토로 안전한 이용 환경을 유지합니다.</li>
          </ul>
        </div>

        <div className="mt-4 grid gap-2 rounded-2xl border border-neutral-200 bg-neutral-50 p-4 text-sm text-neutral-700">
          <p>건전한 운동 커뮤니티와 소개팅 운영을 위해 정책 위반 시 노출 제한 또는 계정 제재가 적용될 수 있습니다.</p>
          <div className="flex flex-wrap gap-2 text-xs">
            <Link href="/dating-policy" className="rounded-full border border-neutral-300 bg-white px-3 py-1.5 font-medium text-neutral-700 hover:bg-neutral-100">
              운영정책 보기
            </Link>
            <Link href="/mypage" className="rounded-full border border-neutral-300 bg-white px-3 py-1.5 font-medium text-neutral-700 hover:bg-neutral-100">
              1:1 문의
            </Link>
          </div>
        </div>

        <div className="mt-5 flex flex-col gap-2 sm:flex-row">
          <button
            type="button"
            onClick={handleConfirm}
            disabled={submitting}
            className="min-h-[48px] flex-1 rounded-2xl bg-amber-500 px-4 text-sm font-semibold text-white hover:bg-amber-600 disabled:opacity-60"
          >
            {submitting ? "확인 중..." : "본인은 만 19세 이상입니다"}
          </button>
          <button
            type="button"
            onClick={handleLeave}
            className="min-h-[48px] flex-1 rounded-2xl border border-neutral-300 bg-white px-4 text-sm font-semibold text-neutral-700 hover:bg-neutral-50"
          >
            아니요, 나가기
          </button>
        </div>

        <p className="mt-3 text-center text-[11px] text-neutral-500">
          로그인 상태에서는 계정 기준으로 1회만 확인합니다.
        </p>
      </div>
    </div>
  );
}
