"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  clearPendingSignup, isConfirmedSignupUser, isSignupEmailRateLimit, readSignupUserWithTimeout,
  rememberSignupEmail, resendSecondsLeft, savePendingSignup, SIGNUP_RESEND_DELAY_MS, type PendingSignup,
} from "@/lib/signup-verification";

const NEXT = "/onboarding/dating";
const VERIFIED_NEXT = `/phone-verification?next=${encodeURIComponent(NEXT)}`;

export default function SignupEmailVerification({ pending, callbackUrl, onResent, onChangeEmail }: {
  pending: PendingSignup;
  callbackUrl: string;
  onResent: (pending: PendingSignup) => void;
  onChangeEmail: () => void;
}) {
  const router = useRouter();
  const [secondsLeft, setSecondsLeft] = useState(() => resendSecondsLeft(pending.resendAvailableAt));
  const [checking, setChecking] = useState(false);
  const [resending, setResending] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const mounted = useRef(false);
  const checkLock = useRef(false);
  const resendLock = useRef(false);
  const navigated = useRef(false);
  const authVersion = useRef(0);
  const deadline = useRef(pending.resendAvailableAt);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      // This is an in-flight request generation, not a DOM ref.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      authVersion.current++;
    };
  }, []);

  useEffect(() => {
    deadline.current = pending.resendAvailableAt;
    const tick = () => setSecondsLeft(resendSecondsLeft(pending.resendAvailableAt));
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [pending.resendAvailableAt]);

  const login = useCallback(() => {
    rememberSignupEmail(pending.email);
    // Existing login flow still verifies the email/session and applies the phone gate.
    router.replace(`/login?tab=password&next=${encodeURIComponent(NEXT)}`);
  }, [pending.email, router]);

  const checkVerification = useCallback(async (manual = false) => {
    if (checkLock.current || navigated.current) return;
    checkLock.current = true;
    setChecking(true);
    if (manual) { setError(""); setNotice(""); }
    const version = authVersion.current;
    try {
      const { data, error: authError } = await readSignupUserWithTimeout(() => createClient().auth.getUser());
      if (!mounted.current || version !== authVersion.current) return;
      const noSession = authError?.name === "AuthSessionMissingError";
      if (authError && !noSession) throw authError;
      if (isConfirmedSignupUser(data.user, pending.email)) {
        navigated.current = true;
        clearPendingSignup();
        router.replace(VERIFIED_NEXT);
      } else if (manual && !data.user) {
        login(); // Another browser/device may have verified it; never claim it is unverified.
      } else if (manual) {
        setNotice(data.user?.email?.toLowerCase() === pending.email.toLowerCase()
          ? "아직 메일 인증이 확인되지 않았어요. 메일의 인증 링크를 누른 뒤 다시 확인해 주세요."
          : "다른 계정으로 로그인되어 있어요. 가입한 이메일로 로그인해 주세요.");
      }
    } catch {
      if (mounted.current && version === authVersion.current && manual) {
        setError("인증 상태를 확인하지 못했어요. 연결 상태를 확인하고 다시 눌러 주세요.");
      }
    } finally {
      checkLock.current = false;
      if (mounted.current) setChecking(false);
    }
  }, [login, pending.email, router]);

  useEffect(() => {
    const checkOnReturn = () => { if (document.visibilityState === "visible") void checkVerification(); };
    let scheduled: ReturnType<typeof setTimeout> | undefined;
    const { data: { subscription } } = createClient().auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_OUT") { authVersion.current++; return; }
      if (!["SIGNED_IN", "USER_UPDATED", "TOKEN_REFRESHED"].includes(event)) return;
      if (session?.user && session.user.email?.trim().toLowerCase() !== pending.email.trim().toLowerCase()) {
        authVersion.current++; // A late response for the former account must not navigate.
      }
      // Calling another Supabase auth method inside its auth callback can deadlock.
      clearTimeout(scheduled);
      scheduled = setTimeout(checkOnReturn, 0);
    });
    scheduled = setTimeout(checkOnReturn, 0);
    window.addEventListener("focus", checkOnReturn);
    document.addEventListener("visibilitychange", checkOnReturn);
    return () => {
      clearTimeout(scheduled);
      subscription.unsubscribe();
      window.removeEventListener("focus", checkOnReturn);
      document.removeEventListener("visibilitychange", checkOnReturn);
    };
  }, [checkVerification, pending.email]);

  const resend = async () => {
    if (resendLock.current || navigated.current || resendSecondsLeft(deadline.current) > 0) return;
    resendLock.current = true;
    setResending(true);
    setError(""); setNotice("");
    const startCooldown = () => {
      const updated = { ...pending, resendAvailableAt: Date.now() + SIGNUP_RESEND_DELAY_MS };
      deadline.current = updated.resendAvailableAt;
      savePendingSignup(updated);
      onResent(updated);
      setSecondsLeft(resendSecondsLeft(updated.resendAvailableAt));
    };
    try {
      const { error: resendError } = await createClient().auth.resend({
        type: "signup", email: pending.email, options: { emailRedirectTo: callbackUrl },
      });
      if (!mounted.current || navigated.current) return;
      if (resendError) {
        if (isSignupEmailRateLimit(resendError)) {
          startCooldown();
          setError("메일 요청이 너무 잦아요. 잠시 기다린 뒤 다시 보내 주세요.");
        } else setError("인증 메일을 보내지 못했어요. 이메일 주소와 연결 상태를 확인하고 다시 시도해 주세요.");
        return;
      }
      startCooldown();
      rememberSignupEmail(pending.email);
      setNotice("인증 메일을 다시 보냈어요. 스팸 메일함도 확인해 주세요.");
    } catch {
      if (mounted.current) setError("인증 메일을 보내지 못했어요. 연결 상태를 확인하고 다시 시도해 주세요.");
    } finally {
      resendLock.current = false;
      if (mounted.current) setResending(false);
    }
  };

  return (
    <section aria-label="이메일 인증 대기" className="space-y-3">
      <div className="rounded-xl border border-neutral-200 bg-neutral-50 p-4 text-sm leading-6 text-neutral-600">
        <p className="break-all font-semibold text-neutral-900">{pending.email}</p>
        <p className="mt-1">이 주소로 보낸 메일에서 인증 링크를 눌러 주세요.</p>
        <p className="mt-1 text-xs text-neutral-500">메일이 없다면 스팸 메일함도 확인해 주세요. 다른 브라우저에서 인증했다면 로그인 후 이어갈 수 있어요.</p>
      </div>
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      {notice && <p role="status" className="text-sm leading-6 text-neutral-600">{notice}</p>}
      <button type="button" onClick={() => void checkVerification(true)} disabled={checking || resending}
        className="min-h-[48px] w-full rounded-xl bg-emerald-600 font-medium text-white disabled:opacity-50">
        {checking ? "인증 확인 중..." : "인증했어요 · 계속하기"}
      </button>
      <button type="button" onClick={() => void resend()} disabled={resending || checking || secondsLeft > 0}
        className="min-h-[48px] w-full rounded-xl border border-neutral-300 font-medium text-neutral-700 disabled:opacity-50">
        {resending ? "재발송 중..." : secondsLeft > 0 ? `${secondsLeft}초 후 다시 보내기` : "인증 메일 다시 보내기"}
      </button>
      <button type="button" onClick={login} className="min-h-[44px] w-full text-sm text-neutral-500 underline underline-offset-4">로그인으로 이동</button>
      <button type="button" onClick={onChangeEmail} disabled={resending || checking}
        className="min-h-[44px] w-full text-xs text-neutral-500 underline underline-offset-4 disabled:opacity-50">이메일 다시 입력</button>
    </section>
  );
}
