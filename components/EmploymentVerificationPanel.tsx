"use client";

import { useCallback, useEffect, useState } from "react";

type Verification = {
  company_name: string;
  email_domain: string;
  verification_method: "admin_manual" | "work_email";
  verified_at: string;
  expires_at: string;
  effective_status: "verified" | "expired" | "revoked";
  revoke_reason: string | null;
};

type Pending = {
  maskedEmail: string;
  companyId: string;
  companyName: string;
  emailDomain: string;
  expiresAt: string;
  resendAfterSec: number;
};

type Company = {
  id: string;
  name: string;
  domains: string[];
};

type ApiResponse = {
  ok?: boolean;
  error?: string;
  message?: string;
  verification?: Verification | null;
  pending?: Pending | null;
  maskedEmail?: string;
  expiresAt?: string;
  resendAfterSec?: number;
  eligible?: boolean;
  domain?: string;
  company?: { id: string; name: string };
  companies?: Company[];
};

export default function EmploymentVerificationPanel() {
  const [verification, setVerification] = useState<Verification | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [companyId, setCompanyId] = useState("");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [checkingEmail, setCheckingEmail] = useState(false);
  const [emailEligibility, setEmailEligibility] = useState<"idle" | "eligible" | "ineligible">("idle");
  const [renewing, setRenewing] = useState(false);
  const [resendAfterSec, setResendAfterSec] = useState(0);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const loadStatus = useCallback(async () => {
    setLoading(true);
    try {
      const [statusResponse, companiesResponse] = await Promise.all([
        fetch("/api/mypage/employment-verification", { cache: "no-store" }),
        fetch("/api/mypage/employment-verification/companies", { cache: "no-store" }),
      ]);
      const [statusBody, companiesBody] = (await Promise.all([
        statusResponse.json().catch(() => ({})),
        companiesResponse.json().catch(() => ({})),
      ])) as [ApiResponse, ApiResponse];
      if (!statusResponse.ok || statusBody.ok === false) {
        throw new Error(statusBody.error || "직장 인증 상태를 불러오지 못했습니다.");
      }
      if (!companiesResponse.ok || companiesBody.ok === false) {
        throw new Error(companiesBody.error || "인증 가능한 회사 목록을 불러오지 못했습니다.");
      }
      const nextCompanies = companiesBody.companies ?? [];
      const nextVerification = statusBody.verification ?? null;
      setCompanies(nextCompanies);
      setVerification(nextVerification);
      setPending(statusBody.pending ?? null);
      setResendAfterSec(statusBody.pending?.resendAfterSec ?? 0);
      setCompanyId(
        statusBody.pending?.companyId ??
          nextCompanies.find((company) => company.name === nextVerification?.company_name)?.id ??
          ""
      );
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "직장 인증 상태를 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  useEffect(() => {
    if (resendAfterSec <= 0) return;
    const timer = window.setInterval(() => {
      setResendAfterSec((current) => Math.max(0, current - 1));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [resendAfterSec]);

  const checkEmailEligibility = async () => {
    const normalizedEmail = email.trim().toLowerCase();
    if (!companyId) {
      setEmailEligibility("ineligible");
      setError("회사를 먼저 선택해주세요.");
      return false;
    }
    if (!normalizedEmail) {
      setEmailEligibility("idle");
      return false;
    }
    setCheckingEmail(true);
    setError("");
    try {
      const response = await fetch("/api/mypage/employment-verification/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyId, email: normalizedEmail }),
      });
      const body = (await response.json().catch(() => ({}))) as ApiResponse;
      if (!response.ok || body.ok === false || body.eligible !== true) {
        setEmailEligibility("ineligible");
        throw new Error(body.error || "직장 이메일로 확인되지 않았습니다.");
      }
      setEmailEligibility("eligible");
      setMessage(body.message || `@${body.domain ?? ""} 회사 이메일을 확인했습니다.`);
      return true;
    } catch (checkError) {
      setError(checkError instanceof Error ? checkError.message : "직장 이메일 확인에 실패했습니다.");
      return false;
    } finally {
      setCheckingEmail(false);
    }
  };

  const sendCode = async () => {
    if (sending || resendAfterSec > 0) return;
    const eligible = emailEligibility === "eligible" || (await checkEmailEligibility());
    if (!eligible) return;
    setSending(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/mypage/employment-verification/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyId, email }),
      });
      const body = (await response.json().catch(() => ({}))) as ApiResponse;
      if (!response.ok || body.ok === false) {
        if (typeof body.resendAfterSec === "number") setResendAfterSec(body.resendAfterSec);
        throw new Error(body.error || "인증번호 발송에 실패했습니다.");
      }
      const nextPending: Pending = {
        maskedEmail: body.maskedEmail ?? email,
        companyId,
        companyName: body.company?.name ?? companies.find((company) => company.id === companyId)?.name ?? "",
        emailDomain: email.split("@").pop()?.toLowerCase() ?? "",
        expiresAt: body.expiresAt ?? new Date(Date.now() + 10 * 60 * 1000).toISOString(),
        resendAfterSec: body.resendAfterSec ?? 60,
      };
      setPending(nextPending);
      setCode("");
      setResendAfterSec(nextPending.resendAfterSec);
      setMessage(body.message || "직장 이메일로 인증번호를 발송했습니다.");
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : "인증번호 발송에 실패했습니다.");
    } finally {
      setSending(false);
    }
  };

  const verifyCode = async () => {
    if (verifying) return;
    setVerifying(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/mypage/employment-verification/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, code }),
      });
      const body = (await response.json().catch(() => ({}))) as ApiResponse;
      if (!response.ok || body.ok === false || !body.verification) {
        throw new Error(body.error || "인증번호 확인에 실패했습니다.");
      }
      setVerification(body.verification);
      setPending(null);
      setRenewing(false);
      setCode("");
      setMessage(body.message || "직장 이메일 인증이 완료되었습니다.");
    } catch (verifyError) {
      setError(verifyError instanceof Error ? verifyError.message : "인증번호 확인에 실패했습니다.");
    } finally {
      setVerifying(false);
    }
  };

  if (loading) {
    return (
      <div className="mt-4 rounded-xl border border-neutral-200 bg-white p-3">
        <div className="h-4 w-28 animate-pulse rounded bg-neutral-200" />
        <div className="mt-3 h-10 animate-pulse rounded-lg bg-neutral-100" />
      </div>
    );
  }

  const isVerified = verification?.effective_status === "verified";
  const isRevoked = verification?.effective_status === "revoked";
  const showForm = !isVerified || renewing;

  return (
    <div className="mt-4 rounded-xl border border-violet-200/80 bg-violet-50/40 p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-2">
            <p className="text-sm font-semibold text-neutral-900">직장인 인증</p>
            {isVerified ? (
              <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-700">인증 완료</span>
            ) : verification?.effective_status === "expired" ? (
              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-700">만료</span>
            ) : isRevoked ? (
              <span className="rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-bold text-red-700">인증 취소</span>
            ) : null}
          </div>
          <p className="mt-1 text-xs leading-5 text-neutral-600">회사 이메일로 인증하면 직장인 인증 마크를 받을 수 있어요.</p>
        </div>
        {isVerified && !renewing ? (
          <button
            type="button"
            onClick={() => {
              setRenewing(true);
              setCompanyId(companies.find((company) => company.name === verification.company_name)?.id ?? "");
              setEmail("");
              setError("");
              setMessage("");
            }}
            className="h-8 rounded-lg border border-violet-200 bg-white px-3 text-xs font-semibold text-violet-700"
          >
            갱신·변경
          </button>
        ) : null}
      </div>

      {verification ? (
        <div className="mt-3 rounded-lg border border-white bg-white/90 px-3 py-2 text-xs leading-5 text-neutral-600">
          <p className="font-semibold text-neutral-800">{verification.company_name}</p>
          <p>@{verification.email_domain} · {verification.verification_method === "work_email" ? "이메일 인증" : "관리자 인증"}</p>
          {isVerified ? <p>유효기간 {new Date(verification.expires_at).toLocaleDateString("ko-KR")}까지</p> : null}
          {isRevoked ? <p className="text-red-700">재인증이 필요하면 고객센터로 문의해주세요.</p> : null}
        </div>
      ) : null}

      {showForm && !isRevoked ? (
        <div className="mt-3 space-y-2">
          <select
            value={companyId}
            onChange={(event) => {
              setCompanyId(event.target.value);
              setEmailEligibility("idle");
              setMessage("");
            }}
            className="h-10 w-full rounded-lg border border-neutral-200 bg-white px-3 text-sm outline-none focus:border-violet-400"
          >
            <option value="">회사를 선택해주세요</option>
            {companies.map((company) => (
              <option key={company.id} value={company.id}>
                {company.name}
              </option>
            ))}
          </select>
          <input
            type="email"
            value={email}
            onChange={(event) => {
              setEmail(event.target.value);
              setEmailEligibility("idle");
              setMessage("");
            }}
            onBlur={() => {
              if (email.trim() && emailEligibility === "idle") void checkEmailEligibility();
            }}
            maxLength={254}
            placeholder="직장 이메일 (예: name@company.com)"
            autoComplete="email"
            className="h-10 w-full rounded-lg border border-neutral-200 bg-white px-3 text-sm outline-none focus:border-violet-400"
          />
          {checkingEmail ? <p className="text-[11px] text-violet-700">회사 이메일 도메인을 확인하는 중...</p> : null}
          {emailEligibility === "eligible" ? <p className="text-[11px] font-semibold text-emerald-700">직장 이메일 도메인 확인 완료</p> : null}
          {companyId ? (
            <p className="text-[11px] leading-5 text-neutral-500">
              승인 도메인: {companies.find((company) => company.id === companyId)?.domains.map((domain) => `@${domain}`).join(", ")}
            </p>
          ) : companies.length === 0 ? (
            <p className="text-[11px] leading-5 text-amber-700">현재 등록된 회사가 없습니다. 관리자에게 회사·도메인 등록을 요청해주세요.</p>
          ) : null}
          <p className="text-[11px] leading-5 text-neutral-500">선택한 회사의 승인 도메인과 일치해야 하며, 이메일 주소 전체는 인증 완료 후 저장하지 않습니다.</p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void sendCode()}
              disabled={sending || checkingEmail || resendAfterSec > 0 || !companyId || !email.trim()}
              className="h-10 rounded-lg border border-violet-200 bg-white px-3 text-sm font-semibold text-violet-700 disabled:opacity-50"
            >
              {sending ? "발송 중..." : checkingEmail ? "이메일 확인 중..." : resendAfterSec > 0 ? `${resendAfterSec}초 후 재발송` : pending ? "인증번호 재발송" : "인증번호 발송"}
            </button>
            {renewing ? (
              <button
                type="button"
                onClick={() => setRenewing(false)}
                className="h-10 rounded-lg px-3 text-sm font-medium text-neutral-500"
              >
                취소
              </button>
            ) : null}
          </div>

          {pending ? (
            <div className="rounded-lg border border-violet-100 bg-white p-3">
              <p className="text-xs text-neutral-600">{pending.maskedEmail}로 보낸 6자리 번호를 10분 안에 입력해주세요.</p>
              {!email.trim() ? <p className="mt-1 text-[11px] text-amber-700">새로고침 후에는 위에 인증번호를 받은 이메일을 다시 입력해야 합니다.</p> : null}
              <div className="mt-2 flex gap-2">
                <input
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  value={code}
                  onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
                  maxLength={6}
                  placeholder="인증번호 6자리"
                  className="h-10 min-w-0 flex-1 rounded-lg border border-neutral-200 bg-white px-3 text-sm tracking-[0.2em] outline-none focus:border-violet-400"
                />
                <button
                  type="button"
                  onClick={() => void verifyCode()}
                  disabled={verifying || code.length !== 6 || !email.trim()}
                  className="h-10 shrink-0 rounded-lg bg-violet-700 px-4 text-sm font-semibold text-white disabled:opacity-50"
                >
                  {verifying ? "확인 중..." : "인증 확인"}
                </button>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {error ? <p className="mt-2 text-xs text-red-600">{error}</p> : null}
      {message ? <p className="mt-2 text-xs text-emerald-700">{message}</p> : null}
    </div>
  );
}
