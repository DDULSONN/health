"use client";

import Link from "next/link";
import { Suspense, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  buildExistingAccountLoginHref,
  buildPasswordResetHref,
  safeAccountRecoveryNext,
} from "@/lib/account-recovery";
import { createClient } from "@/lib/supabase/client";

type RecoveryMethod = "google" | "apple" | "otp" | "password";

function AccountRecoveryContent() {
  const searchParams = useSearchParams();
  const next = useMemo(() => safeAccountRecoveryNext(searchParams.get("next")), [searchParams]);
  const [movingTo, setMovingTo] = useState<RecoveryMethod | null>(null);
  const [error, setError] = useState("");

  const moveToLogin = async (method: RecoveryMethod) => {
    if (movingTo) return;
    setMovingTo(method);
    setError("");
    try {
      const supabase = createClient();
      const { error: signOutError } = await supabase.auth.signOut({ scope: "local" });
      if (signOutError) throw signOutError;
      window.location.assign(
        method === "password"
          ? buildPasswordResetHref(next)
          : buildExistingAccountLoginHref(next, { tab: method, recovery: true }),
      );
    } catch {
      setError("로그인 화면으로 이동하지 못했습니다. 잠시 후 다시 시도해 주세요.");
      setMovingTo(null);
    }
  };

  return (
    <main className="mx-auto max-w-sm px-4 py-12 sm:py-16">
      <section className="rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm">
        <p className="text-xs font-bold text-emerald-700">기존 계정 찾기</p>
        <h1 className="mt-2 text-2xl font-black text-neutral-950">가입했던 방법을 선택해 주세요</h1>
        <p className="mt-2 text-sm leading-6 text-neutral-600">
          개인정보 보호를 위해 휴대폰 번호로 이메일 주소를 보여드리지는 않아요. 예전에 가입했던 방법으로 로그인하면 기존 프로필을 그대로 이용할 수 있습니다.
        </p>

        <div className="mt-6 space-y-2">
          <button
            type="button"
            disabled={Boolean(movingTo)}
            onClick={() => void moveToLogin("google")}
            className="h-12 w-full rounded-xl border border-neutral-300 bg-white text-sm font-bold text-neutral-900 disabled:opacity-50"
          >
            {movingTo === "google" ? "이동 중..." : "Google 계정으로 찾기"}
          </button>
          <button
            type="button"
            disabled={Boolean(movingTo)}
            onClick={() => void moveToLogin("apple")}
            className="h-12 w-full rounded-xl bg-neutral-950 text-sm font-bold text-white disabled:opacity-50"
          >
            {movingTo === "apple" ? "이동 중..." : "Apple 계정으로 찾기"}
          </button>
          <button
            type="button"
            disabled={Boolean(movingTo)}
            onClick={() => void moveToLogin("otp")}
            className="h-12 w-full rounded-xl bg-emerald-600 text-sm font-bold text-white disabled:opacity-50"
          >
            {movingTo === "otp" ? "이동 중..." : "이메일 로그인 링크 받기"}
          </button>
          <button
            type="button"
            disabled={Boolean(movingTo)}
            onClick={() => void moveToLogin("password")}
            className="h-11 w-full rounded-xl border border-neutral-200 bg-neutral-50 text-sm font-semibold text-neutral-700 disabled:opacity-50"
          >
            {movingTo === "password" ? "이동 중..." : "이메일 비밀번호 재설정"}
          </button>
        </div>

        <p className="mt-4 text-xs leading-5 text-neutral-500">
          여러 계정을 사용했다면 예전에 짐툴에 가입한 Google 또는 Apple 계정을 선택해주세요.
        </p>
        {error && <p role="alert" className="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-600">{error}</p>}

        <Link
          href={`/phone-verification?next=${encodeURIComponent(next)}`}
          className="mt-5 block text-center text-xs font-medium text-neutral-500 underline underline-offset-4"
        >
          휴대폰 인증 화면으로 돌아가기
        </Link>
      </section>
    </main>
  );
}

export default function AccountRecoveryPage() {
  return (
    <Suspense fallback={<main className="mx-auto max-w-sm px-4 py-16 text-center text-sm text-neutral-500">불러오는 중...</main>}>
      <AccountRecoveryContent />
    </Suspense>
  );
}
