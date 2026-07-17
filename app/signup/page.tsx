"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { normalizeNickname, validateNickname } from "@/lib/nickname";

const CANONICAL_SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://helchang.com";
const STORED_EMAIL_KEY = "recent_login_email";
const NICKNAME_MAX = 12;
const SIGNUP_NEXT = "/";

type SignupStep = "form" | "pending_verify" | "existing_account";
type SocialProvider = "google" | "apple";

function buildCanonicalCallbackUrl(next: string): string {
  const url = new URL("/auth/callback", CANONICAL_SITE_URL);
  url.searchParams.set("next", next.startsWith("/") ? next : "/");
  return url.toString();
}

function isAlreadyRegisteredError(message: string) {
  const lower = message.toLowerCase();
  return (
    lower.includes("already registered") ||
    lower.includes("already exists") ||
    lower.includes("user already registered")
  );
}

function mapSocialAuthError(providerLabel: string, message: string) {
  const lower = message.toLowerCase();
  if (lower.includes("provider") || lower.includes("unsupported") || lower.includes("not enabled")) {
    return `${providerLabel} 로그인이 아직 준비되지 않았습니다. 잠시 후 다시 시도해 주세요.`;
  }
  return message;
}

export default function SignupPage() {
  const router = useRouter();
  const [step, setStep] = useState<SignupStep>("form");
  const [email, setEmail] = useState("");
  const [nickname, setNickname] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [emailFormOpen, setEmailFormOpen] = useState(false);

  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [submittedEmail, setSubmittedEmail] = useState("");

  useEffect(() => {
    const stored = window.localStorage.getItem(STORED_EMAIL_KEY) ?? "";
    if (stored) setEmail(stored);
  }, []);

  const handleSignup = async (event?: FormEvent<HTMLFormElement>) => {
    event?.preventDefault();
    const normalized = email.trim().toLowerCase();
    const cleanNickname = normalizeNickname(nickname);
    if (!normalized) {
      setError("이메일을 입력해 주세요.");
      return;
    }
    const nicknameError = validateNickname(cleanNickname);
    if (nicknameError) {
      setError(nicknameError);
      return;
    }
    if (password.length < 8) {
      setError("비밀번호는 8자 이상이어야 합니다.");
      return;
    }
    if (password !== passwordConfirm) {
      setError("비밀번호 확인이 일치하지 않습니다.");
      return;
    }

    setLoading(true);
    setError(null);
    setInfo(null);

    try {
      const supabase = createClient();
      const { data, error: signUpError } = await supabase.auth.signUp({
        email: normalized,
        password,
        options: {
          data: { nickname: cleanNickname },
          emailRedirectTo: buildCanonicalCallbackUrl(SIGNUP_NEXT),
        },
      });

      const duplicateFromMessage = signUpError ? isAlreadyRegisteredError(signUpError.message) : false;
      const identities = data.user?.identities;
      const duplicateFromUserShape =
        !signUpError &&
        Array.isArray(identities) &&
        identities.length === 0;

      if (duplicateFromMessage || duplicateFromUserShape) {
        window.localStorage.setItem(STORED_EMAIL_KEY, normalized);
        setSubmittedEmail(normalized);
        setStep("existing_account");
        setError("이미 가입된 이메일입니다. 로그인해 주세요.");
        return;
      }

      if (signUpError) {
        setError(signUpError.message);
        return;
      }

      window.localStorage.setItem(STORED_EMAIL_KEY, normalized);
      setSubmittedEmail(normalized);
      setStep("pending_verify");
      setInfo("가입 요청이 완료되었습니다. 메일함에서 인증 후 로그인하세요.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "회원가입 처리 중 오류가 발생했습니다.");
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    const targetEmail = (submittedEmail || email).trim().toLowerCase();
    if (!targetEmail) {
      setError("이메일을 입력해 주세요.");
      return;
    }

    setResending(true);
    setError(null);

    try {
      const supabase = createClient();
      const { error: resendError } = await supabase.auth.resend({
        type: "signup",
        email: targetEmail,
        options: {
          emailRedirectTo: buildCanonicalCallbackUrl(SIGNUP_NEXT),
        },
      });

      if (resendError) {
        setError(resendError.message);
        return;
      }

      window.localStorage.setItem(STORED_EMAIL_KEY, targetEmail);
      setInfo("인증 메일을 다시 보냈습니다. 메일함을 확인해 주세요.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "인증 메일 재발송에 실패했습니다.");
    } finally {
      setResending(false);
    }
  };

  const handleSocialSignup = async (provider: SocialProvider) => {
    const providerLabel = provider === "apple" ? "Apple" : "Google";
    setLoading(true);
    setError(null);
    setInfo(null);

    try {
      const supabase = createClient();
      const { error: authError } = await supabase.auth.signInWithOAuth({
        provider,
        options: {
          redirectTo: buildCanonicalCallbackUrl(SIGNUP_NEXT),
        },
      });
      if (authError) {
        setError(mapSocialAuthError(providerLabel, authError.message));
        setLoading(false);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : `${providerLabel} 회원가입 중 오류가 발생했습니다.`);
      setLoading(false);
    }
  };

  return (
    <main className="mx-auto max-w-sm px-4 py-12 sm:py-16">
      <h1 className="text-2xl font-bold text-neutral-900 mb-2">회원가입</h1>
      <p className="mb-6 text-sm leading-6 text-neutral-500">소셜 계정으로 빠르게 시작하거나 이메일로 가입할 수 있어요.</p>

      {error && <p role="alert" className="mb-4 rounded-xl bg-red-50 p-3 text-sm text-red-600">{error}</p>}
      {info && <p role="status" aria-live="polite" className="mb-4 rounded-xl bg-emerald-50 p-3 text-sm text-emerald-700">{info}</p>}

      {step === "form" && (
        <div className="space-y-4">
          <button
            type="button"
            onClick={() => handleSocialSignup("google")}
            disabled={loading}
            className="min-h-[52px] w-full rounded-xl border border-neutral-300 bg-white font-medium text-neutral-900 disabled:opacity-50"
          >
            Google로 계속하기
          </button>
          <button
            type="button"
            onClick={() => handleSocialSignup("apple")}
            disabled={loading}
            className="min-h-[52px] w-full rounded-xl border border-neutral-900 bg-neutral-950 font-medium text-white disabled:opacity-50"
          >
            Apple로 계속하기
          </button>

          <div className="flex items-center gap-3 py-1">
            <span className="h-px flex-1 bg-neutral-200" />
            <button
              type="button"
              aria-expanded={emailFormOpen}
              aria-controls="email-signup-form"
              onClick={() => {
                setEmailFormOpen((open) => !open);
                setError(null);
                setInfo(null);
              }}
              className="px-1 py-2 text-xs font-medium text-neutral-500 underline-offset-4 hover:text-neutral-800 hover:underline"
            >
              {emailFormOpen ? "이메일 가입 접기" : "이메일로 가입하기"}
            </button>
            <span className="h-px flex-1 bg-neutral-200" />
          </div>

          {emailFormOpen ? <form id="email-signup-form" onSubmit={handleSignup} className="space-y-3">
            <div>
              <label htmlFor="signup-email" className="text-sm font-medium text-neutral-700">
                이메일
              </label>
              <input
                id="signup-email"
                name="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                autoComplete="email"
                inputMode="email"
                autoCapitalize="none"
                spellCheck={false}
                className="mt-1.5 min-h-[48px] w-full rounded-xl border border-neutral-300 px-3 text-neutral-900"
              />
            </div>

            <div>
              <label htmlFor="signup-nickname" className="text-sm font-medium text-neutral-700">
                닉네임
              </label>
              <input
                id="signup-nickname"
                name="nickname"
                type="text"
                value={nickname}
                onChange={(e) => setNickname(e.target.value)}
                placeholder="닉네임 (예: 벤치왕김OO)"
                maxLength={NICKNAME_MAX}
                autoComplete="nickname"
                className="mt-1.5 min-h-[48px] w-full rounded-xl border border-neutral-300 px-3 text-neutral-900"
              />
            </div>

            <div>
              <label htmlFor="signup-password" className="text-sm font-medium text-neutral-700">
                비밀번호
              </label>
              <input
                id="signup-password"
                name="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="8자 이상"
                autoComplete="new-password"
                className="mt-1.5 min-h-[48px] w-full rounded-xl border border-neutral-300 px-3 text-neutral-900"
              />
            </div>

            <div>
              <label htmlFor="signup-password-confirm" className="text-sm font-medium text-neutral-700">
                비밀번호 확인
              </label>
              <input
                id="signup-password-confirm"
                name="password-confirm"
                type="password"
                value={passwordConfirm}
                onChange={(e) => setPasswordConfirm(e.target.value)}
                placeholder="비밀번호를 다시 입력하세요"
                autoComplete="new-password"
                className="mt-1.5 min-h-[48px] w-full rounded-xl border border-neutral-300 px-3 text-neutral-900"
              />
            </div>

            <div className="space-y-1">
              <p className="text-xs text-neutral-500">닉네임은 2~12자, 한글/영문/숫자/_만 사용할 수 있습니다.</p>
              <p className="text-xs text-neutral-500">비밀번호는 8자 이상이어야 합니다.</p>
              <p className="text-xs leading-5 text-neutral-400">
                가입 시{" "}
                <Link href="/terms" className="underline underline-offset-2">
                  이용약관
                </Link>
                {" "}및{" "}
                <Link href="/privacy" className="underline underline-offset-2">
                  개인정보처리방침
                </Link>
                에 동의한 것으로 간주됩니다.
              </p>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="min-h-[52px] w-full rounded-xl bg-emerald-600 font-medium text-white disabled:opacity-50"
            >
              {loading ? "가입 요청 중..." : "이메일로 회원가입"}
            </button>
          </form> : null}
        </div>
      )}

      {step === "pending_verify" && (
        <div className="space-y-2">
          <button
            type="button"
            onClick={() => router.replace(`/login?tab=password&next=${encodeURIComponent(SIGNUP_NEXT)}`)}
            className="w-full min-h-[48px] rounded-xl bg-emerald-600 text-white font-medium"
          >
            로그인으로 이동
          </button>
          <button
            type="button"
            onClick={handleResend}
            disabled={resending}
            className="w-full min-h-[48px] rounded-xl border border-neutral-300 text-neutral-700 font-medium disabled:opacity-50"
          >
            {resending ? "재발송 중..." : "인증 메일 다시 보내기"}
          </button>
        </div>
      )}

      {step === "existing_account" && (
        <div className="space-y-2">
          <button
            type="button"
            onClick={() => router.replace(`/login?tab=password&next=${encodeURIComponent(SIGNUP_NEXT)}`)}
            className="w-full min-h-[48px] rounded-xl bg-emerald-600 text-white font-medium"
          >
            로그인하러 가기
          </button>
          <button
            type="button"
            onClick={() => router.replace(`/login?tab=password&reset=1&next=${encodeURIComponent(SIGNUP_NEXT)}`)}
            className="w-full min-h-[48px] rounded-xl border border-neutral-300 text-neutral-700 font-medium"
          >
            비밀번호 찾기
          </button>
        </div>
      )}

      <p className="mt-6 text-sm text-neutral-600">
        이미 계정이 있나요?{" "}
        <Link href={`/login?tab=password&next=${encodeURIComponent(SIGNUP_NEXT)}`} className="text-emerald-700 underline">
          로그인
        </Link>
      </p>
    </main>
  );
}
