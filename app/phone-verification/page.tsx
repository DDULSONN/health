"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  buildAccountRecoveryHref,
  buildExistingAccountLoginHref,
  isPhoneAlreadyUsedCode,
  PHONE_ALREADY_USED_CODE,
  safeAccountRecoveryNext,
} from "@/lib/account-recovery";

function safeNextPath(input: string | null): string {
  return safeAccountRecoveryNext(input);
}

function normalizePhoneForOtp(raw: string) {
  const digits = raw.replace(/\D/g, "");
  if (!digits) return "";
  if (digits.startsWith("82")) return `+${digits}`;
  if (digits.startsWith("0")) return `+82${digits.slice(1)}`;
  if (digits.startsWith("1") && digits.length === 11) return `+${digits}`;
  return raw.startsWith("+") ? raw : `+${digits}`;
}

function buildLoginRedirect(next: string) {
  return `/login?redirect=${encodeURIComponent(`/phone-verification?next=${encodeURIComponent(next)}`)}`;
}

function PhoneVerificationContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = useMemo(() => safeNextPath(searchParams.get("next")), [searchParams]);

  const [checking, setChecking] = useState(true);
  const [phone, setPhone] = useState("");
  const [pendingPhone, setPendingPhone] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [resendAfterSec, setResendAfterSec] = useState(0);
  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [switchingAccount, setSwitchingAccount] = useState(false);
  const [error, setError] = useState("");
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [info, setInfo] = useState("");

  useEffect(() => {
    const supabase = createClient();
    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        router.replace(buildLoginRedirect(next));
        return;
      }

      const res = await fetch("/api/mypage/summary?profileOnly=1", { cache: "no-store" }).catch(() => null);
      if (res?.status === 401) {
        router.replace(buildLoginRedirect(next));
        return;
      }
      if (res && !res.ok) {
        setError("인증 상태를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.");
        setChecking(false);
        return;
      }
      const body = res ? ((await res.json().catch(() => ({}))) as { profile?: { phone_verified?: boolean } }) : {};
      if (body.profile?.phone_verified === true) {
        router.replace(next);
        return;
      }
      setChecking(false);
    })();
  }, [next, router]);

  useEffect(() => {
    if (resendAfterSec <= 0) return;
    const timer = window.setTimeout(() => setResendAfterSec((value) => Math.max(0, value - 1)), 1000);
    return () => window.clearTimeout(timer);
  }, [resendAfterSec]);

  const sendCode = async () => {
    if (sending || resendAfterSec > 0) return;
    const normalized = normalizePhoneForOtp(phone);
    if (!normalized) {
      setError("휴대폰 번호를 입력해 주세요.");
      return;
    }

    setSending(true);
    setError("");
    setErrorCode(null);
    setInfo("");
    setPendingPhone(null);
    setCode("");
    try {
      const res = await fetch("/api/mypage/phone-verification/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: normalized }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        code?: string;
        pendingPhone?: string;
        message?: string;
        resendAfterSec?: number;
      };
      if (!res.ok) {
        setErrorCode(isPhoneAlreadyUsedCode(body.code) ? PHONE_ALREADY_USED_CODE : body.code ?? null);
        setError(body.error ?? "인증번호 발송에 실패했습니다.");
        return;
      }
      setPendingPhone(body.pendingPhone ?? normalized);
      setResendAfterSec(body.resendAfterSec ?? 60);
      setInfo(body.message ?? "인증번호를 보냈습니다.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "인증번호 발송에 실패했습니다.");
    } finally {
      setSending(false);
    }
  };

  const verifyCode = async () => {
    if (!pendingPhone) {
      setError("먼저 인증번호를 받아주세요.");
      return;
    }
    const trimmed = code.trim();
    if (!trimmed) {
      setError("인증번호를 입력해 주세요.");
      return;
    }

    setVerifying(true);
    setError("");
    setErrorCode(null);
    try {
      const res = await fetch("/api/mypage/phone-verification/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: pendingPhone, token: trimmed }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string; code?: string; phone_verified?: boolean };
      if (!res.ok || body.phone_verified !== true) {
        setErrorCode(isPhoneAlreadyUsedCode(body.code) ? PHONE_ALREADY_USED_CODE : body.code ?? null);
        setError(body.error ?? "인증번호 확인에 실패했습니다.");
        return;
      }
      setInfo("휴대폰 인증이 완료되었습니다.");
      router.replace(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "인증번호 확인에 실패했습니다.");
    } finally {
      setVerifying(false);
    }
  };

  const moveToExistingAccountLogin = async () => {
    if (switchingAccount) return;
    setSwitchingAccount(true);
    setError("");
    try {
      const supabase = createClient();
      const { error: signOutError } = await supabase.auth.signOut({ scope: "local" });
      if (signOutError) throw signOutError;
      window.location.assign(buildExistingAccountLoginHref(next, { recovery: true }));
    } catch {
      setError("로그인 화면으로 이동하지 못했습니다. 잠시 후 다시 시도해 주세요.");
      setSwitchingAccount(false);
    }
  };

  if (checking) {
    return (
      <main className="mx-auto flex min-h-[70vh] max-w-sm items-center justify-center px-4 py-16">
        <p className="text-sm text-neutral-500">인증 상태를 확인하고 있어요...</p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-sm px-4 py-14">
      <div className="rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm">
        <p className="text-xs font-bold text-emerald-700">마지막 단계</p>
        <h1 className="mt-2 text-2xl font-black text-neutral-950">휴대폰 인증</h1>
        <p className="mt-2 text-sm leading-6 text-neutral-600">
          안전한 이용을 위해 가입 후 휴대폰 인증이 필요합니다.
        </p>

        <div className="mt-6 space-y-3">
          <input
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            value={phone}
            onChange={(event) => {
              setPhone(event.target.value);
              setPendingPhone(null);
              setCode("");
              setError("");
              setErrorCode(null);
              setInfo("");
            }}
            placeholder="01012345678"
            className="h-12 w-full rounded-xl border border-neutral-300 px-3 text-base outline-none focus:border-emerald-500"
          />
          <button
            type="button"
            onClick={sendCode}
            disabled={sending || resendAfterSec > 0}
            className="h-12 w-full rounded-xl bg-neutral-950 text-sm font-bold text-white disabled:opacity-50"
          >
            {sending ? "발송 중..." : resendAfterSec > 0 ? `${resendAfterSec}초 후 재발송` : "인증번호 받기"}
          </button>

          {pendingPhone && (
            <div className="grid grid-cols-[1fr_auto] gap-2">
              <input
                type="text"
                inputMode="numeric"
                value={code}
                onChange={(event) => setCode(event.target.value)}
                placeholder="인증번호"
                className="h-12 rounded-xl border border-neutral-300 px-3 text-base outline-none focus:border-emerald-500"
              />
              <button
                type="button"
                onClick={verifyCode}
                disabled={verifying}
                className="h-12 rounded-xl bg-emerald-600 px-4 text-sm font-bold text-white disabled:opacity-50"
              >
                {verifying ? "확인 중..." : "확인"}
              </button>
            </div>
          )}
        </div>

        {errorCode === PHONE_ALREADY_USED_CODE ? (
          <div role="alert" className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4">
            <p className="text-sm font-bold text-amber-950">이미 가입된 휴대폰 번호예요</p>
            <p className="mt-1 text-xs leading-5 text-amber-800">
              새 계정에서는 이 번호를 다시 인증할 수 없습니다. 기존 계정으로 로그인하면 이전 프로필을 그대로 이용할 수 있어요.
            </p>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <button
                type="button"
                disabled={switchingAccount}
                onClick={() => void moveToExistingAccountLogin()}
                className="h-10 rounded-lg bg-neutral-950 px-3 text-xs font-bold text-white disabled:opacity-50"
              >
                {switchingAccount ? "이동 중..." : "기존 계정 로그인"}
              </button>
              <button
                type="button"
                disabled={switchingAccount}
                onClick={() => window.location.assign(buildAccountRecoveryHref(next))}
                className="h-10 rounded-lg border border-amber-300 bg-white px-3 text-xs font-bold text-amber-900 disabled:opacity-50"
              >
                계정 찾기
              </button>
            </div>
            {error && error !== "이미 다른 계정에 등록된 번호입니다." && (
              <p className="mt-3 text-xs text-red-600">{error}</p>
            )}
          </div>
        ) : error ? (
          <p role="alert" className="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-600">{error}</p>
        ) : null}
        {info && <p className="mt-4 rounded-xl bg-emerald-50 p-3 text-sm text-emerald-700">{info}</p>}
      </div>
    </main>
  );
}

export default function PhoneVerificationPage() {
  return (
    <Suspense fallback={<main className="mx-auto max-w-sm px-4 py-16">로딩 중...</main>}>
      <PhoneVerificationContent />
    </Suspense>
  );
}
