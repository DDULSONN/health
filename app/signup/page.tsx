"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

const CANONICAL_SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://helchang.com";
const STORED_EMAIL_KEY = "recent_login_email";
const NICKNAME_MIN = 2;
const NICKNAME_MAX = 12;

type SignupStep = "form" | "pending_verify" | "existing_account";

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

export default function SignupPage() {
  const router = useRouter();
  const [step, setStep] = useState<SignupStep>("form");
  const [email, setEmail] = useState("");
  const [nickname, setNickname] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");

  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [submittedEmail, setSubmittedEmail] = useState("");

  useEffect(() => {
    const stored = window.localStorage.getItem(STORED_EMAIL_KEY) ?? "";
    if (stored) setEmail(stored);
  }, []);

  const handleSignup = async () => {
    const normalized = email.trim().toLowerCase();
    const cleanNickname = nickname.trim();
    if (!normalized) {
      setError("이메일을 입력해 주세요.");
      return;
    }
    if (cleanNickname.length < NICKNAME_MIN || cleanNickname.length > NICKNAME_MAX) {
      setError(`닉네임은 ${NICKNAME_MIN}~${NICKNAME_MAX}자로 입력해 주세요.`);
      return;
    }
    if (!/^[0-9A-Za-z가-힣_]+$/.test(cleanNickname)) {
      setError("닉네임은 한글/영문/숫자/_만 사용할 수 있습니다.");
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
          emailRedirectTo: buildCanonicalCallbackUrl("/"),
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
          emailRedirectTo: buildCanonicalCallbackUrl("/"),
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

  return (
    <main className="max-w-sm mx-auto px-4 py-16">
      <h1 className="text-2xl font-bold text-neutral-900 mb-2">회원가입</h1>
      <p className="text-sm text-neutral-500 mb-6">이메일 인증 후 로그인할 수 있습니다.</p>

      {error && <p className="mb-4 rounded-xl bg-red-50 p-3 text-sm text-red-600">{error}</p>}
      {info && <p className="mb-4 rounded-xl bg-emerald-50 p-3 text-sm text-emerald-700">{info}</p>}

      {step === "form" && (
        <div className="space-y-2">
          <label htmlFor="signup-email" className="text-sm font-medium text-neutral-700">
            이메일
          </label>
          <input
            id="signup-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            className="w-full min-h-[48px] rounded-xl border border-neutral-300 px-3 text-neutral-900"
          />

          <label htmlFor="signup-nickname" className="text-sm font-medium text-neutral-700">
            닉네임
          </label>
          <input
            id="signup-nickname"
            type="text"
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
            placeholder="헬창닉네임 (예: 벤치왕김OO)"
            maxLength={NICKNAME_MAX}
            className="w-full min-h-[48px] rounded-xl border border-neutral-300 px-3 text-neutral-900"
          />

          <label htmlFor="signup-password" className="text-sm font-medium text-neutral-700">
            비밀번호
          </label>
          <input
            id="signup-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="8자 이상"
            className="w-full min-h-[48px] rounded-xl border border-neutral-300 px-3 text-neutral-900"
          />

          <label htmlFor="signup-password-confirm" className="text-sm font-medium text-neutral-700">
            비밀번호 확인
          </label>
          <input
            id="signup-password-confirm"
            type="password"
            value={passwordConfirm}
            onChange={(e) => setPasswordConfirm(e.target.value)}
            placeholder="비밀번호를 다시 입력하세요"
            className="w-full min-h-[48px] rounded-xl border border-neutral-300 px-3 text-neutral-900"
          />

          <p className="text-xs text-neutral-500 mt-1">닉네임은 2~12자, 한글/영문/숫자/_만 사용할 수 있습니다.</p>
          <p className="text-xs text-neutral-500">비밀번호는 8자 이상이어야 합니다.</p>
          <p className="text-xs text-neutral-400">가입 시 이용약관 및 개인정보처리방침에 동의한 것으로 간주됩니다.</p>

          <button
            type="button"
            onClick={handleSignup}
            disabled={loading}
            className="w-full min-h-[52px] rounded-xl bg-emerald-600 text-white font-medium disabled:opacity-50 mt-2"
          >
            {loading ? "가입 요청 중..." : "이메일로 회원가입"}
          </button>
        </div>
      )}

      {step === "pending_verify" && (
        <div className="space-y-2">
          <button
            type="button"
            onClick={() => router.replace("/login?tab=password&next=/")}
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
            onClick={() => router.replace("/login?tab=password&next=/")}
            className="w-full min-h-[48px] rounded-xl bg-emerald-600 text-white font-medium"
          >
            로그인하러 가기
          </button>
          <button
            type="button"
            onClick={() => router.replace("/login?tab=password&reset=1&next=/")}
            className="w-full min-h-[48px] rounded-xl border border-neutral-300 text-neutral-700 font-medium"
          >
            비밀번호 찾기
          </button>
        </div>
      )}

      <p className="mt-6 text-sm text-neutral-600">
        이미 계정이 있나요?{" "}
        <Link href="/login?tab=password&next=/" className="text-emerald-700 underline">
          로그인
        </Link>
      </p>
    </main>
  );
}
