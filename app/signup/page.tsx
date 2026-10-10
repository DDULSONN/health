"use client";

import Link from "next/link";
import SignupProgress from "@/components/dating/SignupProgress";
import SignupStories from "@/components/SignupStories";
import SignupEmailVerification from "@/components/SignupEmailVerification";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { normalizeNickname, validateNickname } from "@/lib/nickname";
import { isValidReferralCode, normalizeReferralCode } from "@/lib/referral-code";
import { EMAIL_CONSENT_LABEL, EMAIL_CONSENT_DESCRIPTION } from "@/lib/signup-email-consent";
import { beginGrowthSignup, cancelGrowthSignup, recordGrowthEmailSignup } from "@/lib/growth-analytics";
import { clearPendingSignup, newPendingSignup, readPendingSignup, readSignupEmail, rememberSignupEmail, rememberSignupReferral, savePendingSignup, type PendingSignup } from "@/lib/signup-verification";

const CANONICAL_SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://helchang.com";
const NICKNAME_MAX = 12;
const SIGNUP_NEXT = "/onboarding/dating";

type SignupStep = "form" | "pending_verify" | "existing_account";
type SocialProvider = "google" | "apple";
type ReferralCodeStatus = "idle" | "checking" | "valid" | "invalid";

function buildCanonicalCallbackUrl(next: string, referralCode?: string, consentToken?: string | null): string {
  const url = new URL("/auth/callback", CANONICAL_SITE_URL);
  url.searchParams.set("next", next.startsWith("/") ? next : "/");
  if (consentToken) url.searchParams.set("signup_consent", consentToken);
  const normalizedReferralCode = normalizeReferralCode(referralCode);
  if (isValidReferralCode(normalizedReferralCode)) {
    url.searchParams.set("ref", normalizedReferralCode);
  }
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
  const [emailMarketingConsent, setEmailMarketingConsent] = useState(false);
  const [referralFormOpen, setReferralFormOpen] = useState(false);
  const [referralCode, setReferralCode] = useState("");
  const [referralCodeStatus, setReferralCodeStatus] = useState<ReferralCodeStatus>("idle");
  const [referralCodeMessage, setReferralCodeMessage] = useState("");

  const [loading, setLoading] = useState(false);
  // Lock synchronously, before referral validation or consent preparation awaits.
  const signupLock = useRef(false);
  const referralValidationVersion = useRef(0);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [pendingVerification, setPendingVerification] = useState<PendingSignup | null>(null);

  useEffect(() => {
    const pending = readPendingSignup();
    if (pending) {
      setPendingVerification(pending);
      setEmail(pending.email);
      setReferralCode(pending.referralCode);
      setStep("pending_verify");
      return;
    }
    const stored = readSignupEmail();
    if (stored) setEmail(stored);

    const codeFromUrl = normalizeReferralCode(new URLSearchParams(window.location.search).get("ref"));
    if (!codeFromUrl) return;

    setReferralCode(codeFromUrl);
    setReferralFormOpen(true);
    setReferralCodeStatus("checking");
    const version = ++referralValidationVersion.current;
    const controller = new AbortController();
    void fetch(`/api/referrals/validate?code=${encodeURIComponent(codeFromUrl)}`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        const body = (await response.json().catch(() => ({}))) as {
          valid?: boolean;
          inviterNickname?: string | null;
          message?: string;
        };
        if (controller.signal.aborted || version !== referralValidationVersion.current) return;
        if (!response.ok || body.valid !== true) {
          setReferralCodeStatus("invalid");
          setReferralCodeMessage(body.message ?? "유효하지 않은 추천 코드입니다.");
          return;
        }
        setReferralCodeStatus("valid");
        setReferralCodeMessage(
          body.inviterNickname ? `${body.inviterNickname}님의 추천 코드입니다.` : "사용 가능한 추천 코드입니다."
        );
      })
      .catch((requestError) => {
        if (controller.signal.aborted || version !== referralValidationVersion.current) return;
        if (requestError instanceof DOMException && requestError.name === "AbortError") return;
        setReferralCodeStatus("invalid");
        setReferralCodeMessage("추천 코드를 확인하지 못했습니다. 다시 시도해 주세요.");
      });

    return () => controller.abort();
  }, []);

  const validateCurrentReferralCode = async () => {
    const version = ++referralValidationVersion.current;
    const code = normalizeReferralCode(referralCode);
    if (!code) {
      setReferralCodeStatus("idle");
      setReferralCodeMessage("");
      return true;
    }
    if (!isValidReferralCode(code)) {
      setReferralCodeStatus("invalid");
      setReferralCodeMessage("추천 코드 형식이 올바르지 않습니다.");
      return false;
    }

    setReferralCode(code);
    setReferralCodeStatus("checking");
    setReferralCodeMessage("추천 코드를 확인하고 있습니다.");
    try {
      const response = await fetch(`/api/referrals/validate?code=${encodeURIComponent(code)}`, {
        cache: "no-store",
        signal: AbortSignal.timeout(10000),
      });
      const body = (await response.json().catch(() => ({}))) as {
        valid?: boolean;
        inviterNickname?: string | null;
        message?: string;
      };
      if (version !== referralValidationVersion.current) return false;
      if (!response.ok || body.valid !== true) {
        setReferralCodeStatus("invalid");
        setReferralCodeMessage(body.message ?? "유효하지 않은 추천 코드입니다.");
        return false;
      }
      setReferralCodeStatus("valid");
      setReferralCodeMessage(
        body.inviterNickname ? `${body.inviterNickname}님의 추천 코드입니다.` : "사용 가능한 추천 코드입니다."
      );
      return true;
    } catch {
      if (version !== referralValidationVersion.current) return false;
      setReferralCodeStatus("invalid");
      setReferralCodeMessage("추천 코드를 확인하지 못했습니다. 다시 시도해 주세요.");
      return false;
    }
  };

  const handleSignup = async (event?: FormEvent<HTMLFormElement>) => {
    event?.preventDefault();
    if (signupLock.current) return;
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
    signupLock.current = true;
    setLoading(true);
    setError(null);
    setInfo(null);

    try {
      if (!(await validateCurrentReferralCode())) {
        setError("추천 코드를 다시 확인하거나 입력란을 비워주세요.");
        return;
      }
      const supabase = createClient();
      const cleanReferralCode = normalizeReferralCode(referralCode);
      const consentToken = await prepareEmailConsent("email", normalized);
      beginGrowthSignup("email");
      const { data, error: signUpError } = await supabase.auth.signUp({
        email: normalized,
        password,
        options: {
          data: {
            nickname: cleanNickname,
            ...(consentToken ? { signup_email_consent_token: consentToken } : {}),
            ...(cleanReferralCode ? { referral_code: cleanReferralCode } : {}),
          },
          emailRedirectTo: buildCanonicalCallbackUrl(SIGNUP_NEXT, cleanReferralCode),
        },
      });

      const duplicateFromMessage = signUpError ? isAlreadyRegisteredError(signUpError.message) : false;
      const identities = data.user?.identities;
      const duplicateFromUserShape =
        !signUpError &&
        Array.isArray(identities) &&
        identities.length === 0;

      if (duplicateFromMessage || duplicateFromUserShape) {
        cancelGrowthSignup();
        rememberSignupEmail(normalized);
        clearPendingSignup();
        setStep("existing_account");
        setError("이미 가입된 이메일입니다. 로그인해 주세요.");
        return;
      }

      if (signUpError) {
        cancelGrowthSignup();
        setError(signUpError.message);
        return;
      }

      recordGrowthEmailSignup(data.user);
      rememberSignupEmail(normalized);
      if (data.session && cleanReferralCode) {
        await fetch("/api/referrals/claim", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code: cleanReferralCode }),
          signal: AbortSignal.timeout(4000),
        }).catch(() => null);
      }
      if (data.session && consentToken) {
        await fetch("/api/signup/email-marketing", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "record", token: consentToken }), signal: AbortSignal.timeout(4000),
        }).catch(() => null);
      }
      const pending = newPendingSignup(normalized, cleanReferralCode);
      savePendingSignup(pending);
      setPendingVerification(pending);
      setPassword("");
      setPasswordConfirm("");
      setStep("pending_verify");
      setInfo(emailMarketingConsent && !consentToken ? "가입 요청은 완료됐지만, 광고성 이메일 수신 동의는 저장되지 않았습니다." : null);
    } catch (e) {
      cancelGrowthSignup();
      setError(e instanceof Error ? e.message : "회원가입 처리 중 오류가 발생했습니다.");
    } finally {
      signupLock.current = false;
      setLoading(false);
    }
  };

  const prepareEmailConsent = async (provider: "email" | SocialProvider, targetEmail = ""): Promise<string | null> => {
    try {
      const response = await fetch("/api/signup/email-marketing", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "prepare", consented: emailMarketingConsent, provider, email: targetEmail }),
        signal: AbortSignal.timeout(4000),
      });
      const body = await response.json();
      return response.ok && typeof body.token === "string" ? body.token : null;
    } catch { return null; }
  };

  const handleSocialSignup = async (provider: SocialProvider) => {
    if (signupLock.current) return;
    const providerLabel = provider === "apple" ? "Apple" : "Google";
    signupLock.current = true;
    setLoading(true);
    setError(null);
    setInfo(null);

    let leavingForProvider = false;
    try {
      if (!(await validateCurrentReferralCode())) {
        setError("추천 코드를 다시 확인하거나 입력란을 비워주세요.");
        return;
      }
      const supabase = createClient();
      const cleanReferralCode = normalizeReferralCode(referralCode);
      const consentToken = await prepareEmailConsent(provider);
      if (emailMarketingConsent && !consentToken) alert("광고성 이메일 수신 동의는 저장되지 않았습니다. 회원가입은 계속 진행합니다.");
      rememberSignupReferral(isValidReferralCode(cleanReferralCode) ? cleanReferralCode : "");
      beginGrowthSignup(provider);
      const { error: authError } = await supabase.auth.signInWithOAuth({
        provider,
        options: {
          redirectTo: buildCanonicalCallbackUrl(SIGNUP_NEXT, cleanReferralCode, consentToken),
        },
      });
      if (authError) {
        cancelGrowthSignup();
        rememberSignupReferral("");
        setError(mapSocialAuthError(providerLabel, authError.message));
      } else leavingForProvider = true;
    } catch (e) {
      cancelGrowthSignup();
      rememberSignupReferral("");
      setError(e instanceof Error ? e.message : `${providerLabel} 회원가입 중 오류가 발생했습니다.`);
    } finally {
      if (!leavingForProvider) {
        signupLock.current = false;
        setLoading(false);
      }
    }
  };

  return (
    <main className="mx-auto max-w-sm px-4 py-12 sm:py-16">
      <SignupProgress current={0} />
      <h1 className="text-2xl font-bold text-neutral-900 mb-2">회원가입</h1>
      <p className="mb-6 text-sm leading-6 text-neutral-500">가입 후 휴대폰을 인증하고, 소개 프로필을 작성해요.</p>

      {error && <p role="alert" className="mb-4 rounded-xl bg-red-50 p-3 text-sm text-red-600">{error}</p>}
      {info && <p role="status" aria-live="polite" className="mb-4 rounded-xl bg-emerald-50 p-3 text-sm text-emerald-700">{info}</p>}

      {step === "form" && (
        <div className="space-y-4">
          <div className="rounded-xl border border-neutral-100 px-3 py-2">
            <label className="flex min-h-[44px] cursor-pointer items-center gap-2 text-xs text-neutral-700">
              <input type="checkbox" checked={emailMarketingConsent} disabled={loading} onChange={(event) => setEmailMarketingConsent(event.target.checked)} className="h-4 w-4 shrink-0 accent-emerald-600" aria-describedby="signup-email-consent-description" />
              <span>{EMAIL_CONSENT_LABEL}</span>
            </label>
            <p id="signup-email-consent-description" className="pb-1 text-[11px] leading-5 text-neutral-500">{EMAIL_CONSENT_DESCRIPTION}</p>
          </div>
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
              disabled={loading}
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
                disabled={loading}
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
                disabled={loading}
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
                disabled={loading}
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
                disabled={loading}
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

          <div className="border-t border-neutral-100 pt-2 text-center">
            <button
              type="button"
              aria-expanded={referralFormOpen}
              aria-controls="signup-referral-form"
              disabled={loading}
              onClick={() => {
                setReferralFormOpen((open) => !open);
                setError(null);
              }}
              className="min-h-[36px] px-2 text-xs font-medium text-neutral-400 underline-offset-4 hover:text-neutral-700 hover:underline"
            >
              {referralFormOpen ? "추천 코드 접기" : "추천 코드가 있나요?"}
            </button>

            {referralFormOpen ? (
              <div id="signup-referral-form" className="mt-1 rounded-lg border border-neutral-200 bg-neutral-50/70 p-2.5 text-left">
                <label htmlFor="signup-referral-code" className="text-xs font-semibold text-neutral-700">
                  추천 코드 <span className="font-normal text-neutral-400">(선택)</span>
                </label>
                <input
                  id="signup-referral-code"
                  disabled={loading}
                  name="referral-code"
                  type="text"
                  value={referralCode}
                  onChange={(event) => {
                    referralValidationVersion.current++;
                    setReferralCode(normalizeReferralCode(event.target.value));
                    setReferralCodeStatus("idle");
                    setReferralCodeMessage("");
                    setError(null);
                  }}
                  onBlur={() => { if (!signupLock.current) void validateCurrentReferralCode(); }}
                  placeholder="추천 코드 입력"
                  maxLength={16}
                  autoCapitalize="characters"
                  autoComplete="off"
                  spellCheck={false}
                  className="mt-1.5 min-h-[40px] w-full rounded-lg border border-neutral-200 bg-white px-3 font-mono text-xs uppercase tracking-wide text-neutral-900 outline-none focus:border-emerald-500"
                />
                <p className="mt-1.5 text-[11px] leading-4 text-neutral-500">
                  조건 완료 시 추천인과 가입자 모두 지원권 5장 지급
                </p>
                {referralCodeMessage ? (
                  <p
                    role={referralCodeStatus === "invalid" ? "alert" : "status"}
                    className={`mt-1 text-[11px] font-medium ${
                      referralCodeStatus === "valid"
                        ? "text-emerald-700"
                        : referralCodeStatus === "invalid"
                          ? "text-red-600"
                          : "text-neutral-500"
                    }`}
                  >
                    {referralCodeStatus === "checking" ? "확인 중..." : referralCodeMessage}
                  </p>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      )}

      {step === "pending_verify" && pendingVerification && (
        <SignupEmailVerification
          pending={pendingVerification}
          callbackUrl={buildCanonicalCallbackUrl(SIGNUP_NEXT, pendingVerification.referralCode)}
          onResent={setPendingVerification}
          onChangeEmail={() => {
            clearPendingSignup();
            setPendingVerification(null);
            setStep("form");
            setEmailFormOpen(true);
            setError(null);
            setInfo("이메일 주소를 수정하고 가입을 다시 진행해 주세요. 이전 주소로 보낸 가입 요청은 변경되지 않습니다.");
          }}
        />
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

      {step !== "pending_verify" && <p className="mt-6 text-sm text-neutral-600">
        이미 계정이 있나요?{" "}
        <Link href={`/login?tab=password&next=${encodeURIComponent(SIGNUP_NEXT)}`} className="text-emerald-700 underline">
          로그인
        </Link>
      </p>}
      {step === "form" && <SignupStories />}
    </main>
  );
}
