"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";

const CANONICAL_SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://helchang.com";
const STORED_EMAIL_KEY = "recent_login_email";
const RESET_SENT_AT_KEY = "password_reset_sent_at";
const RESEND_COOLDOWN_SECONDS = 60;

type ViewState = "checking" | "request" | "update";

type RecoveryParams = {
  mode: string | null;
  code: string | null;
  tokenHash: string | null;
  otpType: string | null;
  accessToken: string | null;
  refreshToken: string | null;
  error: string | null;
  errorCode: string | null;
  errorDescription: string | null;
};

function normalizeEmail(value: string | null): string {
  return (value ?? "").trim().toLowerCase();
}

function parseRecoveryParams(): RecoveryParams {
  const params = new URLSearchParams(window.location.search);
  const hash = window.location.hash.startsWith("#")
    ? window.location.hash.slice(1)
    : window.location.hash;

  if (hash) {
    const hashParams = new URLSearchParams(hash);
    for (const [key, value] of hashParams.entries()) {
      if (!params.has(key) && value) params.set(key, value);
    }
  }

  return {
    mode: params.get("mode"),
    code: params.get("code"),
    tokenHash: params.get("token_hash"),
    otpType: params.get("type"),
    accessToken: params.get("access_token"),
    refreshToken: params.get("refresh_token"),
    error: params.get("error"),
    errorCode: params.get("error_code"),
    errorDescription: params.get("error_description"),
  };
}

function buildResetRedirectUrl(): string {
  const url = new URL("/auth/reset-password", CANONICAL_SITE_URL);
  url.searchParams.set("mode", "update");
  return url.toString();
}

function mapRecoveryError(message: string, code?: string | null): string {
  const lower = `${code ?? ""} ${message}`.toLowerCase();

  if (
    lower.includes("otp_expired") ||
    lower.includes("expired") ||
    lower.includes("invalid token") ||
    lower.includes("token has expired")
  ) {
    return "재설정 링크가 만료되었거나 이미 사용됐어요. 아래에서 새 링크를 받아 주세요.";
  }
  if (
    lower.includes("flow state") ||
    lower.includes("code verifier") ||
    lower.includes("pkce")
  ) {
    return "재설정을 요청한 브라우저와 링크를 연 브라우저가 달라 인증을 이어갈 수 없어요. 지금 브라우저에서 새 링크를 받아 다시 열어 주세요.";
  }
  if (lower.includes("rate limit") || lower.includes("too many requests")) {
    return "요청이 너무 많아요. 잠시 기다린 뒤 다시 시도해 주세요.";
  }
  if (lower.includes("invalid email")) {
    return "이메일 형식이 올바르지 않습니다.";
  }
  if (lower.includes("same password") || lower.includes("different from the old password")) {
    return "기존 비밀번호와 다른 비밀번호를 입력해 주세요.";
  }
  if (lower.includes("weak password") || lower.includes("password should be")) {
    return "비밀번호는 8자 이상으로 안전하게 입력해 주세요.";
  }
  if (lower.includes("session") || lower.includes("auth session missing")) {
    return "재설정 인증이 만료됐어요. 아래에서 새 링크를 받아 주세요.";
  }

  return "비밀번호 재설정 중 오류가 발생했어요. 잠시 후 다시 시도해 주세요.";
}

export default function ResetPasswordPage() {
  const router = useRouter();
  const [view, setView] = useState<ViewState>("checking");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [sending, setSending] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createClient();
    let active = true;

    const setRequestView = (text?: string) => {
      if (!active) return;
      setView("request");
      if (text) setError(text);
    };

    const setUpdateView = () => {
      if (!active) return;
      window.history.replaceState({}, "", "/auth/reset-password?mode=update");
      setError(null);
      setMessage(null);
      setView("update");
    };

    const { data: authListener } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") setUpdateView();
    });

    const storedEmail = normalizeEmail(window.localStorage.getItem(STORED_EMAIL_KEY));
    if (storedEmail) setEmail(storedEmail);

    const sentAt = Number(window.localStorage.getItem(RESET_SENT_AT_KEY) ?? "0");
    const secondsLeft = Math.max(
      0,
      RESEND_COOLDOWN_SECONDS - Math.floor((Date.now() - sentAt) / 1000)
    );
    setCooldown(secondsLeft);

    (async () => {
      const params = parseRecoveryParams();
      const providerError = params.errorCode ?? params.error;

      if (providerError) {
        setRequestView(
          mapRecoveryError(params.errorDescription ?? providerError, providerError)
        );
        return;
      }

      try {
        let exchangeError: Error | null = null;

        if (params.code) {
          const { error: codeError } = await supabase.auth.exchangeCodeForSession(params.code);
          exchangeError = codeError;
        } else if (params.tokenHash) {
          const { error: otpError } = await supabase.auth.verifyOtp({
            token_hash: params.tokenHash,
            type: (params.otpType || "recovery") as EmailOtpType,
          });
          exchangeError = otpError;
        } else if (params.accessToken && params.refreshToken) {
          const { error: sessionError } = await supabase.auth.setSession({
            access_token: params.accessToken,
            refresh_token: params.refreshToken,
          });
          exchangeError = sessionError;
        }

        const {
          data: { session },
        } = await supabase.auth.getSession();

        if (session && (params.mode === "update" || params.code || params.tokenHash || params.accessToken)) {
          setUpdateView();
          return;
        }

        if (exchangeError) {
          setRequestView(mapRecoveryError(exchangeError.message));
          return;
        }

        if (params.mode === "update") {
          setRequestView("재설정 인증이 없거나 만료됐어요. 새 링크를 받아 주세요.");
          return;
        }

        setRequestView();
      } catch (caught) {
        const detail = caught instanceof Error ? caught.message : "unknown";
        setRequestView(mapRecoveryError(detail));
      }
    })();

    return () => {
      active = false;
      authListener.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = window.setInterval(() => {
      setCooldown((current) => Math.max(0, current - 1));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [cooldown]);

  const handleSendReset = async (event: FormEvent) => {
    event.preventDefault();
    const normalized = normalizeEmail(email);

    if (!normalized) {
      setError("이메일을 입력해 주세요.");
      return;
    }
    if (cooldown > 0) {
      setError(`${cooldown}초 후 다시 보낼 수 있어요.`);
      return;
    }

    setSending(true);
    setError(null);
    setMessage(null);

    try {
      const supabase = createClient();
      const { error: sendError } = await supabase.auth.resetPasswordForEmail(normalized, {
        redirectTo: buildResetRedirectUrl(),
      });

      if (sendError) {
        setError(mapRecoveryError(sendError.message));
        return;
      }

      window.localStorage.setItem(STORED_EMAIL_KEY, normalized);
      window.localStorage.setItem(RESET_SENT_AT_KEY, String(Date.now()));
      setCooldown(RESEND_COOLDOWN_SECONDS);
      setMessage("재설정 메일을 보냈어요. 받은 메일의 링크를 열어 새 비밀번호를 설정해 주세요.");
    } catch (caught) {
      const detail = caught instanceof Error ? caught.message : "unknown";
      setError(mapRecoveryError(detail));
    } finally {
      setSending(false);
    }
  };

  const handleUpdatePassword = async (event: FormEvent) => {
    event.preventDefault();

    if (password.length < 8) {
      setError("비밀번호는 8자 이상이어야 합니다.");
      return;
    }
    if (password !== confirm) {
      setError("비밀번호 확인이 일치하지 않습니다.");
      return;
    }

    setUpdating(true);
    setError(null);
    setMessage(null);

    try {
      const supabase = createClient();
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session) {
        setView("request");
        setError("재설정 인증이 만료됐어요. 새 링크를 받아 주세요.");
        return;
      }

      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) {
        setError(mapRecoveryError(updateError.message));
        return;
      }

      setMessage("비밀번호가 변경되었습니다. 새 비밀번호로 로그인해 주세요.");
      await supabase.auth.signOut({ scope: "local" });
      window.setTimeout(() => router.replace("/login?tab=password&reset=success"), 700);
    } catch (caught) {
      const detail = caught instanceof Error ? caught.message : "unknown";
      setError(mapRecoveryError(detail));
    } finally {
      setUpdating(false);
    }
  };

  return (
    <main className="mx-auto min-h-[70vh] w-full max-w-sm px-4 py-14">
      <h1 className="mb-2 text-2xl font-bold text-neutral-900">비밀번호 재설정</h1>

      {view === "checking" ? (
        <div className="mt-8 rounded-xl border border-neutral-200 p-5 text-center text-sm text-neutral-500">
          재설정 링크를 확인하고 있어요...
        </div>
      ) : (
        <>
          <p className="mb-6 text-sm leading-6 text-neutral-500">
            {view === "update"
              ? "새로 사용할 비밀번호를 입력해 주세요."
              : "가입한 이메일로 비밀번호 재설정 링크를 보내드려요."}
          </p>

          <div aria-live="polite">
            {error && (
              <p className="mb-4 rounded-xl bg-red-50 p-3 text-sm leading-5 text-red-600">{error}</p>
            )}
            {message && (
              <p className="mb-4 rounded-xl bg-emerald-50 p-3 text-sm leading-5 text-emerald-700">
                {message}
              </p>
            )}
          </div>

          {view === "request" ? (
            <form onSubmit={handleSendReset} className="space-y-3">
              <label htmlFor="reset-email" className="block text-sm font-medium text-neutral-700">
                이메일
              </label>
              <input
                id="reset-email"
                type="email"
                inputMode="email"
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="you@example.com"
                className="min-h-[48px] w-full rounded-xl border border-neutral-300 px-3 text-neutral-900 outline-none focus:border-emerald-600"
              />
              <button
                type="submit"
                disabled={sending || cooldown > 0}
                className="min-h-[48px] w-full rounded-xl bg-emerald-600 font-medium text-white disabled:opacity-50"
              >
                {sending
                  ? "전송 중..."
                  : cooldown > 0
                    ? `${cooldown}초 후 다시 보내기`
                    : "재설정 링크 보내기"}
              </button>
            </form>
          ) : (
            <form onSubmit={handleUpdatePassword} className="space-y-3">
              <label htmlFor="new-password" className="block text-sm font-medium text-neutral-700">
                새 비밀번호
              </label>
              <input
                id="new-password"
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="8자 이상"
                className="min-h-[48px] w-full rounded-xl border border-neutral-300 px-3 text-neutral-900 outline-none focus:border-emerald-600"
              />
              <label
                htmlFor="new-password-confirm"
                className="block text-sm font-medium text-neutral-700"
              >
                새 비밀번호 확인
              </label>
              <input
                id="new-password-confirm"
                type="password"
                autoComplete="new-password"
                value={confirm}
                onChange={(event) => setConfirm(event.target.value)}
                placeholder="비밀번호 다시 입력"
                className="min-h-[48px] w-full rounded-xl border border-neutral-300 px-3 text-neutral-900 outline-none focus:border-emerald-600"
              />
              <button
                type="submit"
                disabled={updating}
                className="min-h-[48px] w-full rounded-xl bg-emerald-600 font-medium text-white disabled:opacity-50"
              >
                {updating ? "변경 중..." : "비밀번호 변경"}
              </button>
            </form>
          )}

          <Link href="/login?tab=password" className="mt-5 block text-center text-sm text-neutral-500 underline">
            로그인으로 돌아가기
          </Link>
        </>
      )}
    </main>
  );
}
