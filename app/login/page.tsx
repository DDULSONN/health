"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

const STORED_EMAIL_KEY = "recent_login_email";
const CANONICAL_SITE_URL = "https://helchang.com";
const IN_APP_UA_PATTERNS = ["kakaotalk", "instagram", "naver", "fban", "fbav", "line"];

type AuthMode = "google" | "otp" | "password";

function safeNextPath(input: string | null): string {
  if (!input || !input.startsWith("/")) return "/";
  if (input.startsWith("//")) return "/";
  return input;
}

function isInAppBrowser(ua: string): boolean {
  const lowered = ua.toLowerCase();
  return IN_APP_UA_PATTERNS.some((token) => lowered.includes(token));
}

function buildCanonicalCallbackUrl(next: string): string {
  const url = new URL("/auth/callback", CANONICAL_SITE_URL);
  url.searchParams.set("next", safeNextPath(next));
  return url.toString();
}

function LoginContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const next = safeNextPath(searchParams.get("next") ?? searchParams.get("redirect") ?? "/");
  const errorParam = searchParams.get("error");
  const errorCode = searchParams.get("error_code")?.toLowerCase() ?? null;
  const errorDescription = searchParams.get("error_description");

  const [mode, setMode] = useState<AuthMode>("google");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [googleLoading, setGoogleLoading] = useState(false);
  const [otpLoading, setOtpLoading] = useState(false);
  const [passwordLoading, setPasswordLoading] = useState(false);

  const [inAppBrowser, setInAppBrowser] = useState(false);
  const [sessionChecking, setSessionChecking] = useState(true);

  const callbackUrl = useMemo(() => buildCanonicalCallbackUrl(next), [next]);

  const isOtpExpired = errorCode === "otp_expired";
  const isFlowStateMissing = errorCode === "flow_state_missing";

  const initialErrorMessage = useMemo(() => {
    if (isOtpExpired) return "로그인 링크가 만료되었거나 이미 사용됐어요. 다시 보내드릴게요.";
    if (isFlowStateMissing)
      return "세션 정보가 사라졌습니다. 브라우저를 유지한 상태로 다시 시도해 주세요.";
    if (errorDescription) return errorDescription;
    if (errorCode) return `로그인 오류가 발생했습니다. (${errorCode})`;
    if (errorParam) return errorParam;
    return null;
  }, [errorCode, errorDescription, errorParam, isFlowStateMissing, isOtpExpired]);

  useEffect(() => {
    const stored = window.localStorage.getItem(STORED_EMAIL_KEY);
    if (stored) setEmail(stored);
    setInAppBrowser(isInAppBrowser(navigator.userAgent));

    (async () => {
      try {
        const supabase = createClient();
        const {
          data: { session },
        } = await supabase.auth.getSession();

        if (session) {
          setError(null);
          setSuccess("✅ 로그인되었습니다. 이동 중...");
          setTimeout(() => router.replace(next || "/"), 800);
          return;
        }
        setError(initialErrorMessage);
      } finally {
        setSessionChecking(false);
      }
    })();
  }, [initialErrorMessage, next, router]);

  const handleGoogleLogin = async () => {
    if (inAppBrowser) return;
    setGoogleLoading(true);
    setError(null);
    setSuccess(null);

    try {
      const supabase = createClient();
      const { error: authError } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: callbackUrl,
        },
      });
      if (authError) {
        setError(authError.message);
        setGoogleLoading(false);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Google 로그인 중 오류가 발생했습니다.");
      setGoogleLoading(false);
    }
  };

  const sendMagicLink = async () => {
    const normalized = email.trim().toLowerCase();
    if (!normalized) {
      setError("이메일을 입력해 주세요.");
      return;
    }

    setOtpLoading(true);
    setError(null);
    setSuccess(null);

    try {
      const supabase = createClient();
      const { error: authError } = await supabase.auth.signInWithOtp({
        email: normalized,
        options: {
          emailRedirectTo: callbackUrl,
        },
      });

      if (authError) {
        setError(authError.message);
        return;
      }

      window.localStorage.setItem(STORED_EMAIL_KEY, normalized);
      setSuccess("메일을 확인해 링크를 클릭하세요. (유효시간 10분)");
    } catch (e) {
      setError(e instanceof Error ? e.message : "이메일 링크 전송에 실패했습니다.");
    } finally {
      setOtpLoading(false);
    }
  };

  const handlePasswordLogin = async () => {
    const normalized = email.trim().toLowerCase();
    if (!normalized || !password.trim()) {
      setError("이메일과 비밀번호를 입력해 주세요.");
      return;
    }

    setPasswordLoading(true);
    setError(null);
    setSuccess(null);

    try {
      const supabase = createClient();
      const { error: authError } = await supabase.auth.signInWithPassword({
        email: normalized,
        password,
      });

      if (authError) {
        setError(authError.message);
        return;
      }

      window.localStorage.setItem(STORED_EMAIL_KEY, normalized);
      setSuccess("✅ 로그인되었습니다. 이동 중...");
      setTimeout(() => router.replace(next || "/"), 800);
    } catch (e) {
      setError(e instanceof Error ? e.message : "비밀번호 로그인에 실패했습니다.");
    } finally {
      setPasswordLoading(false);
    }
  };

  const handleSignUp = async () => {
    const normalized = email.trim().toLowerCase();
    if (!normalized || !password.trim()) {
      setError("이메일과 비밀번호를 입력해 주세요.");
      return;
    }

    setPasswordLoading(true);
    setError(null);
    setSuccess(null);

    try {
      const supabase = createClient();
      const { error: authError } = await supabase.auth.signUp({
        email: normalized,
        password,
        options: {
          emailRedirectTo: buildCanonicalCallbackUrl("/"),
        },
      });

      if (authError) {
        setError(authError.message);
        return;
      }

      window.localStorage.setItem(STORED_EMAIL_KEY, normalized);
      setSuccess("가입 요청이 완료되었습니다. 메일 인증 후 로그인해 주세요.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "회원가입 처리 중 오류가 발생했습니다.");
    } finally {
      setPasswordLoading(false);
    }
  };

  const handleOpenExternal = () => {
    const href = window.location.href;
    const ua = navigator.userAgent.toLowerCase();

    if (ua.includes("android")) {
      const withoutProtocol = href.replace(/^https?:\/\//, "");
      window.location.href = `intent://${withoutProtocol}#Intent;scheme=https;package=com.android.chrome;end`;
      return;
    }

    window.open(href, "_blank", "noopener,noreferrer");
  };

  if (sessionChecking) {
    return (
      <main className="max-w-sm mx-auto px-4 py-16">
        <p className="text-neutral-400 text-center">로그인 상태 확인 중...</p>
      </main>
    );
  }

  if (success?.includes("✅ 로그인되었습니다")) {
    return (
      <main className="max-w-sm mx-auto px-4 py-16 flex items-center justify-center min-h-[70vh]">
        <p className="text-sm text-emerald-700 bg-emerald-50 rounded-xl p-4 w-full text-center">{success}</p>
      </main>
    );
  }

  return (
    <main className="max-w-sm mx-auto px-4 py-16 flex flex-col items-center min-h-[70vh] justify-center">
      <h1 className="text-2xl font-bold text-neutral-900 mb-2">로그인</h1>
      <p className="text-sm text-neutral-500 mb-6 text-center">커뮤니티 참여와 기록 관리를 위해 로그인하세요.</p>

      {error && <p className="text-sm text-red-600 bg-red-50 rounded-xl p-3 mb-4 w-full text-center">{error}</p>}
      {success && <p className="text-sm text-emerald-700 bg-emerald-50 rounded-xl p-3 mb-4 w-full text-center">{success}</p>}

      {inAppBrowser && (
        <div className="w-full mb-4 rounded-xl border border-amber-300 bg-amber-50 p-3">
          <p className="text-sm text-amber-900 font-medium">인앱 브라우저에서는 Google 로그인이 실패할 수 있어요.</p>
          <button
            type="button"
            onClick={handleOpenExternal}
            className="mt-2 w-full min-h-[40px] rounded-lg bg-amber-600 text-white text-sm font-medium"
          >
            Chrome/Safari로 열기
          </button>
        </div>
      )}

      {(isOtpExpired || isFlowStateMissing) && (
        <button
          type="button"
          onClick={sendMagicLink}
          disabled={otpLoading}
          className="w-full mb-4 min-h-[44px] rounded-lg bg-amber-600 text-white text-sm font-medium disabled:opacity-50"
        >
          {otpLoading ? "재전송 중..." : "로그인 링크 다시 보내기"}
        </button>
      )}

      <div className="w-full grid grid-cols-3 rounded-xl border border-neutral-200 overflow-hidden mb-4">
        <button type="button" onClick={() => setMode("google")} className={`min-h-[42px] text-xs font-medium ${mode === "google" ? "bg-emerald-600 text-white" : "bg-white text-neutral-700"}`}>Google</button>
        <button type="button" onClick={() => setMode("otp")} className={`min-h-[42px] text-xs font-medium ${mode === "otp" ? "bg-emerald-600 text-white" : "bg-white text-neutral-700"}`}>이메일 링크</button>
        <button type="button" onClick={() => setMode("password")} className={`min-h-[42px] text-xs font-medium ${mode === "password" ? "bg-emerald-600 text-white" : "bg-white text-neutral-700"}`}>비밀번호</button>
      </div>

      <div className="w-full space-y-2">
        {(mode === "otp" || mode === "password") && (
          <>
            <label htmlFor="email" className="text-sm text-neutral-700 font-medium">이메일</label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              autoComplete="email"
              className="w-full min-h-[48px] px-3 rounded-xl border border-neutral-300 text-neutral-900"
            />
          </>
        )}

        {mode === "google" && (
          <button
            type="button"
            onClick={handleGoogleLogin}
            disabled={googleLoading || inAppBrowser}
            className="w-full min-h-[48px] rounded-xl border-2 border-neutral-200 bg-white text-neutral-800 font-medium disabled:opacity-50"
          >
            {inAppBrowser ? "인앱에서는 Google 로그인 제한" : googleLoading ? "Google 로그인 중..." : "Google로 로그인"}
          </button>
        )}

        {mode === "otp" && (
          <button
            type="button"
            onClick={sendMagicLink}
            disabled={otpLoading}
            className="w-full min-h-[48px] rounded-xl bg-emerald-600 text-white font-medium disabled:opacity-50"
          >
            {otpLoading ? "전송 중..." : "로그인 메일 보내기"}
          </button>
        )}

        {mode === "password" && (
          <>
            <label htmlFor="password" className="text-sm text-neutral-700 font-medium">비밀번호</label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="비밀번호"
              autoComplete="current-password"
              className="w-full min-h-[48px] px-3 rounded-xl border border-neutral-300 text-neutral-900"
            />
            <button
              type="button"
              onClick={handlePasswordLogin}
              disabled={passwordLoading}
              className="w-full min-h-[48px] rounded-xl bg-emerald-600 text-white font-medium disabled:opacity-50"
            >
              {passwordLoading ? "로그인 중..." : "이메일/비밀번호 로그인"}
            </button>
            <button
              type="button"
              onClick={handleSignUp}
              disabled={passwordLoading}
              className="w-full min-h-[44px] rounded-xl border border-neutral-300 text-neutral-700 text-sm font-medium disabled:opacity-50"
            >
              {passwordLoading ? "처리 중..." : "이메일 회원가입"}
            </button>
            <Link href="/auth/reset-password" className="block text-xs text-emerald-700 underline text-center pt-1">
              비밀번호를 잊으셨나요?
            </Link>
          </>
        )}
      </div>

      <p className="text-xs text-neutral-400 mt-6 text-center">로그인하면 서비스 이용약관 및 개인정보처리방침에 동의한 것으로 간주됩니다.</p>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <main className="max-w-sm mx-auto px-4 py-16">
          <p className="text-neutral-400 text-center">로딩 중...</p>
        </main>
      }
    >
      <LoginContent />
    </Suspense>
  );
}
