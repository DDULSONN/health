"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import { isEmailConfirmed } from "@/lib/auth-confirmed";
import { isValidReferralCode, normalizeReferralCode } from "@/lib/referral-code";
import { safeInternalPath } from "@/lib/safe-internal-path";

const STORED_EMAIL_KEY = "recent_login_email";
const PENDING_REFERRAL_KEY = "pending_signup_referral";
const PENDING_REFERRAL_MAX_AGE_MS = 30 * 60 * 1000;
const CANONICAL_SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://helchang.com";
const IN_APP_UA_PATTERNS = ["kakaotalk", "instagram", "naver", "fban", "fbav", "line"];

type CallbackState = {
  next: string;
  email: string;
  code: string | null;
  tokenHash: string | null;
  otpType: string | null;
  accessToken: string | null;
  refreshToken: string | null;
  error: string | null;
  errorCode: string | null;
  errorDescription: string | null;
  referralCode: string | null;
  recovery: boolean;
};

type ViewState =
  | { kind: "processing" }
  | { kind: "success" }
  | { kind: "recovery"; detail: string };

function safeNextPath(input: string | null): string {
  return safeInternalPath(input);
}

function withPhoneVerificationGate(next: string): string {
  const safeNext = safeNextPath(next);
  if (safeNext.startsWith("/phone-verification")) return safeNext;
  return `/phone-verification?next=${encodeURIComponent(safeNext)}`;
}

function normalizeEmail(input: string | null): string {
  return (input ?? "").trim().toLowerCase();
}

function isInAppBrowser(ua: string): boolean {
  const lowered = ua.toLowerCase();
  return IN_APP_UA_PATTERNS.some((token) => lowered.includes(token));
}

function parseStateFromLocation(): CallbackState {
  const merged = new URLSearchParams(window.location.search);
  const hashRaw = window.location.hash.startsWith("#") ? window.location.hash.slice(1) : window.location.hash;

  if (hashRaw) {
    const hashParams = new URLSearchParams(hashRaw);
    for (const [key, value] of hashParams.entries()) {
      if (!merged.has(key) && value) merged.set(key, value);
    }
  }

  return {
    next: safeNextPath(merged.get("next")),
    email: normalizeEmail(merged.get("email")),
    code: merged.get("code"),
    tokenHash: merged.get("token_hash"),
    otpType: merged.get("type"),
    accessToken: merged.get("access_token"),
    refreshToken: merged.get("refresh_token"),
    error: merged.get("error"),
    errorCode: merged.get("error_code"),
    errorDescription: merged.get("error_description"),
    referralCode: normalizeReferralCode(merged.get("ref")) || null,
    recovery: merged.get("recovery") === "1",
  };
}

function readPendingReferralCode(): string | null {
  try {
    const raw = window.localStorage.getItem(PENDING_REFERRAL_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { code?: unknown; createdAt?: unknown };
    const code = normalizeReferralCode(parsed.code);
    const createdAt = Number(parsed.createdAt);
    if (!isValidReferralCode(code) || !Number.isFinite(createdAt) || Date.now() - createdAt > PENDING_REFERRAL_MAX_AGE_MS) {
      window.localStorage.removeItem(PENDING_REFERRAL_KEY);
      return null;
    }
    return code;
  } catch {
    window.localStorage.removeItem(PENDING_REFERRAL_KEY);
    return null;
  }
}

function buildCanonicalCallbackUrl(next: string, recovery = false): string {
  const url = new URL("/auth/callback", CANONICAL_SITE_URL);
  url.searchParams.set("next", safeNextPath(next));
  if (recovery) url.searchParams.set("recovery", "1");
  return url.toString();
}

function buildLoginHref(next: string, email: string, recovery = false): string {
  const params = new URLSearchParams();
  params.set("next", safeNextPath(next));
  if (email) params.set("email", email);
  if (recovery) {
    params.set("reason", "phone_already_used");
    params.set("tab", "otp");
    params.set("recovery", "1");
  }
  return `/login?${params.toString()}`;
}

export default function AuthCallbackPage() {
  const router = useRouter();
  const [state, setState] = useState<CallbackState | null>(null);
  const [viewState, setViewState] = useState<ViewState>({ kind: "processing" });
  const [email, setEmail] = useState("");
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [inAppBrowser, setInAppBrowser] = useState(false);

  useEffect(() => {
    const parsed = parseStateFromLocation();
    setState(parsed);
    setInAppBrowser(isInAppBrowser(navigator.userAgent));

    const stored = normalizeEmail(window.localStorage.getItem(STORED_EMAIL_KEY));
    const seedEmail = parsed.email || stored;
    if (seedEmail) setEmail(seedEmail);

    (async () => {
      const supabase = createClient();
      const next = parsed.next || "/";
      const gatedNext = withPhoneVerificationGate(next);
      const referralCode = isValidReferralCode(parsed.referralCode)
        ? normalizeReferralCode(parsed.referralCode)
        : readPendingReferralCode();

      const claimReferral = async () => {
        if (!referralCode) return;
        try {
          const response = await fetch("/api/referrals/claim", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ code: referralCode }),
          });
          if (response.status < 500) {
            window.localStorage.removeItem(PENDING_REFERRAL_KEY);
          }
        } catch (claimError) {
          console.error("[auth/callback] referral claim failed", claimError);
        }
      };

      const finalizeSuccess = async () => {
        const {
          data: { session },
        } = await supabase.auth.getSession();

        if (session) {
          if (parsed.recovery) {
            const profileResponse = await fetch("/api/mypage/summary?profileOnly=1", { cache: "no-store" }).catch(() => null);
            if (profileResponse?.ok) {
              const profileBody = (await profileResponse.json().catch(() => ({}))) as {
                profile?: { phone_verified?: boolean };
              };
              if (profileBody.profile?.phone_verified !== true) {
                const { error: signOutError } = await supabase.auth.signOut({ scope: "local" });
                setViewState({
                  kind: "recovery",
                  detail: signOutError ? "recovery_signout_failed" : "recovery_account_mismatch",
                });
                return;
              }
            }
          }
          await claimReferral();
          router.replace(gatedNext);
          return;
        }

        setViewState({ kind: "success" });
      };

      const hasConfirmedUser = async () => {
        const {
          data: { user },
        } = await supabase.auth.getUser();
        return Boolean(user && isEmailConfirmed(user));
      };

      const {
        data: { session: initialSession },
      } = await supabase.auth.getSession();
      if (initialSession) {
        await finalizeSuccess();
        return;
      }

      if (await hasConfirmedUser()) {
        await finalizeSuccess();
        return;
      }

      if (parsed.code) {
        await supabase.auth.exchangeCodeForSession(parsed.code);
        const {
          data: { session: afterCodeSession },
        } = await supabase.auth.getSession();
        if (afterCodeSession || (await hasConfirmedUser())) {
          await finalizeSuccess();
          return;
        }
      }

      if (parsed.tokenHash && parsed.otpType) {
        await supabase.auth.verifyOtp({
          token_hash: parsed.tokenHash,
          type: parsed.otpType as EmailOtpType,
        });
        const {
          data: { session: afterOtpSession },
        } = await supabase.auth.getSession();
        if (afterOtpSession || (await hasConfirmedUser())) {
          await finalizeSuccess();
          return;
        }
      }

      if (parsed.accessToken && parsed.refreshToken) {
        await supabase.auth.setSession({
          access_token: parsed.accessToken,
          refresh_token: parsed.refreshToken,
        });
        const {
          data: { session: afterTokenSession },
        } = await supabase.auth.getSession();
        if (afterTokenSession || (await hasConfirmedUser())) {
          await finalizeSuccess();
          return;
        }
      }

      const {
        data: { session: finalSession },
      } = await supabase.auth.getSession();
      if (finalSession || (await hasConfirmedUser())) {
        await finalizeSuccess();
        return;
      }

      const detail = parsed.errorCode?.toLowerCase() ?? parsed.error?.toLowerCase() ?? "";
      setViewState({ kind: "recovery", detail });
    })();
  }, [router]);

  const gatedNext = withPhoneVerificationGate(state?.next ?? "/");

  const recoveryMessage = useMemo(() => {
    if (!state || viewState.kind !== "recovery") return "";

    if (viewState.detail === "otp_expired" || viewState.detail === "access_denied") {
      return "인증 링크가 만료됐거나 이미 사용됐어요. 계정은 만들어졌을 수 있으니 로그인해 주세요.";
    }

    if (viewState.detail === "recovery_account_mismatch") {
      return "선택한 계정에는 기존 휴대폰 인증이 없습니다. 예전에 사용한 다른 계정으로 로그인해 주세요.";
    }

    if (viewState.detail === "recovery_signout_failed") {
      return "계정을 다시 선택할 준비를 하지 못했어요. 브라우저를 새로고침한 뒤 다시 시도해 주세요.";
    }

    if (state.errorDescription) return state.errorDescription;
    return "인증 링크를 확인하지 못했어요. 계정이 이미 준비됐을 수 있으니 로그인해 주세요.";
  }, [state, viewState]);

  const handleResend = async () => {
    const normalized = normalizeEmail(email);
    if (!normalized) {
      setMessage("이메일을 입력해 주세요.");
      return;
    }

    setSending(true);
    setMessage(null);

    try {
      const supabase = createClient();
      const callbackUrl = buildCanonicalCallbackUrl(gatedNext, state?.recovery === true);
      const isSignupLink = state?.otpType === "signup";
      const { error } = isSignupLink
        ? await supabase.auth.resend({
            type: "signup",
            email: normalized,
            options: {
              emailRedirectTo: callbackUrl,
            },
          })
        : await supabase.auth.signInWithOtp({
            email: normalized,
            options: {
              emailRedirectTo: callbackUrl,
              shouldCreateUser: state?.recovery !== true,
            },
          });

      if (error) {
        setMessage(error.message);
        return;
      }

      window.localStorage.setItem(STORED_EMAIL_KEY, normalized);
      setMessage("인증 메일을 보냈어요. 인앱 브라우저에서 실패하면 Safari/Chrome으로 열어주세요.");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "인증 메일 전송에 실패했어요.");
    } finally {
      setSending(false);
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

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setMessage("현재 링크를 복사했어요.");
    } catch {
      setMessage("링크 복사에 실패했어요. 주소창에서 직접 복사해 주세요.");
    }
  };

  if (!state || viewState.kind === "processing") {
    return (
      <main className="max-w-sm mx-auto px-4 py-20">
        <p className="text-sm text-neutral-500 text-center">인증 상태를 확인하고 있어요...</p>
      </main>
    );
  }

  if (viewState.kind === "success") {
    return (
      <main className="max-w-sm mx-auto px-4 py-16">
        <div className="rounded-xl border border-emerald-300 bg-emerald-50 p-4">
          <h1 className="text-base font-semibold text-emerald-900">이메일 인증 완료!</h1>
          <p className="mt-1 text-sm text-emerald-800">로그인 후 휴대폰 인증까지 완료하면 바로 이용할 수 있어요.</p>

          <div className="mt-4 grid grid-cols-1 gap-2">
            <Link
              href={buildLoginHref(gatedNext, email, state.recovery)}
              className="inline-flex min-h-[44px] items-center justify-center rounded-lg bg-emerald-600 text-white text-sm font-medium"
            >
              로그인하러 가기
            </Link>
            <Link
              href="/"
              className="inline-flex min-h-[44px] items-center justify-center rounded-lg border border-emerald-300 bg-white text-emerald-900 text-sm font-medium"
            >
              홈으로
            </Link>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="max-w-sm mx-auto px-4 py-16">
      <div className="rounded-xl border border-amber-300 bg-amber-50 p-4">
        <h1 className="text-base font-semibold text-amber-900">이메일 인증 확인</h1>
        <p className="mt-1 text-sm text-amber-800">{recoveryMessage}</p>

        <div className="mt-3 grid grid-cols-1 gap-2">
          <Link
            href={buildLoginHref(gatedNext, email, state.recovery)}
            className="inline-flex min-h-[44px] items-center justify-center rounded-lg bg-amber-600 text-white text-sm font-medium"
          >
            로그인하러 가기
          </Link>

          <label htmlFor="callback-email" className="text-xs text-amber-900">
            이메일
          </label>
          <input
            id="callback-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            autoComplete="email"
            className="w-full min-h-[44px] rounded-lg border border-amber-300 bg-white px-3 text-sm"
          />
          <button
            type="button"
            onClick={handleResend}
            disabled={sending}
            className="w-full min-h-[44px] rounded-lg border border-amber-300 bg-white text-amber-900 text-sm font-medium disabled:opacity-50"
          >
            {sending ? "재발송 중..." : "인증 메일 다시 받기"}
          </button>
          {message && <p className="text-xs text-amber-900">{message}</p>}

          {inAppBrowser && (
            <>
              <p className="text-xs text-amber-800">인앱 브라우저에서는 실패할 수 있어요. Safari/Chrome으로 열어주세요.</p>
              <button
                type="button"
                onClick={handleOpenExternal}
                className="min-h-[42px] rounded-lg bg-amber-600 text-white text-sm font-medium"
              >
                Safari/Chrome으로 열기
              </button>
              <button
                type="button"
                onClick={handleCopyLink}
                className="min-h-[42px] rounded-lg border border-amber-300 bg-white text-amber-900 text-sm font-medium"
              >
                링크 복사
              </button>
            </>
          )}
        </div>
      </div>
    </main>
  );
}
