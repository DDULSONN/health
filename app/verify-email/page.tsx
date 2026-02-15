"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { isEmailConfirmed } from "@/lib/auth-confirmed";

const STORED_EMAIL_KEY = "recent_login_email";
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://helchang.com";

type VerifyState = "checking" | "ready" | "redirecting";

function safeNextPath(input: string | null): string {
  if (!input || !input.startsWith("/")) return "/";
  if (input.startsWith("//")) return "/";
  return input;
}

function VerifyEmailContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = safeNextPath(searchParams.get("next") ?? "/");

  const [state, setState] = useState<VerifyState>("checking");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [resending, setResending] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  const callbackUrl = useMemo(() => {
    const url = new URL("/auth/callback", SITE_URL);
    url.searchParams.set("next", next);
    return url.toString();
  }, [next]);

  useEffect(() => {
    const supabase = createClient();
    const stored = window.localStorage.getItem(STORED_EMAIL_KEY) ?? "";

    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      const targetEmail = user?.email ?? stored;
      if (targetEmail) setEmail(targetEmail);

      if (!user) {
        router.replace(`/login?next=${encodeURIComponent(next)}`);
        return;
      }

      if (isEmailConfirmed(user)) {
        setState("redirecting");
        setMessage("이미 인증되었습니다. 이동 중...");
        setTimeout(() => router.replace(next), 500);
        return;
      }

      setState("ready");
    })();
  }, [next, router]);

  const handleResend = async () => {
    const normalized = email.trim().toLowerCase();
    if (!normalized) {
      setError("인증 메일을 보낼 이메일을 입력해 주세요.");
      return;
    }

    setResending(true);
    setError(null);
    setMessage(null);

    try {
      const supabase = createClient();
      const { error: resendError } = await supabase.auth.resend({
        type: "signup",
        email: normalized,
        options: {
          emailRedirectTo: callbackUrl,
        },
      });

      if (resendError) {
        setError(resendError.message);
        return;
      }

      window.localStorage.setItem(STORED_EMAIL_KEY, normalized);
      setMessage("인증 메일을 다시 보냈습니다. 메일함을 확인해 주세요.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "인증 메일 재발송에 실패했습니다.");
    } finally {
      setResending(false);
    }
  };

  const handleLogout = async () => {
    setLoggingOut(true);
    setError(null);

    try {
      const supabase = createClient();
      await supabase.auth.signOut();
      router.replace("/");
    } catch (e) {
      setError(e instanceof Error ? e.message : "로그아웃에 실패했습니다.");
      setLoggingOut(false);
    }
  };

  if (state === "checking" || state === "redirecting") {
    return (
      <main className="max-w-sm mx-auto px-4 py-16">
        <p className="text-sm text-neutral-500 text-center">{message ?? "상태 확인 중..."}</p>
      </main>
    );
  }

  return (
    <main className="max-w-sm mx-auto px-4 py-16">
      <h1 className="text-2xl font-bold text-neutral-900 mb-2">이메일 인증 필요</h1>
      <p className="text-sm text-neutral-600 mb-5">
        메일 인증 후 이용 가능합니다. 메일함에서 인증 링크를 클릭해 주세요.
      </p>

      {error && <p className="mb-3 rounded-xl bg-red-50 p-3 text-sm text-red-600">{error}</p>}
      {message && <p className="mb-3 rounded-xl bg-emerald-50 p-3 text-sm text-emerald-700">{message}</p>}

      <label htmlFor="verify-email" className="text-sm font-medium text-neutral-700">
        이메일
      </label>
      <input
        id="verify-email"
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        className="mt-1 w-full min-h-[48px] rounded-xl border border-neutral-300 px-3 text-neutral-900"
        placeholder="you@example.com"
        autoComplete="email"
      />

      <div className="mt-3 space-y-2">
        <button
          type="button"
          onClick={handleResend}
          disabled={resending}
          className="w-full min-h-[48px] rounded-xl bg-emerald-600 text-white font-medium disabled:opacity-50"
        >
          {resending ? "재발송 중..." : "인증 메일 다시 보내기"}
        </button>
        <button
          type="button"
          onClick={handleLogout}
          disabled={loggingOut}
          className="w-full min-h-[48px] rounded-xl border border-neutral-300 text-neutral-700 font-medium disabled:opacity-50"
        >
          {loggingOut ? "로그아웃 중..." : "로그아웃"}
        </button>
      </div>
    </main>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense
      fallback={
        <main className="max-w-sm mx-auto px-4 py-16">
          <p className="text-sm text-neutral-500 text-center">로딩 중...</p>
        </main>
      }
    >
      <VerifyEmailContent />
    </Suspense>
  );
}
