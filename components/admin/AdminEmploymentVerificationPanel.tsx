"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";

type Verification = {
  id: string;
  user_id: string;
  company_name: string;
  email_domain: string;
  status: "verified" | "revoked";
  effective_status: "verified" | "revoked" | "expired";
  verification_method: "admin_manual" | "work_email";
  verified_at: string;
  expires_at: string;
  revoked_at: string | null;
  revoke_reason: string | null;
  updated_at: string;
};

type EmploymentUser = {
  userId: string;
  nickname: string | null;
  role: string | null;
  isBanned: boolean;
  accountEmail: string | null;
  verification: Verification | null;
};

type ApiResponse = {
  ok?: boolean;
  code?: string;
  error?: string;
  items?: EmploymentUser[];
  item?: Verification;
};

const STATUS_LABEL: Record<Verification["effective_status"], string> = {
  verified: "인증 유효",
  expired: "인증 만료",
  revoked: "인증 취소",
};

const STATUS_STYLE: Record<Verification["effective_status"], string> = {
  verified: "bg-emerald-100 text-emerald-800",
  expired: "bg-amber-100 text-amber-800",
  revoked: "bg-red-100 text-red-800",
};

export default function AdminEmploymentVerificationPanel() {
  const [recentItems, setRecentItems] = useState<EmploymentUser[]>([]);
  const [searchItems, setSearchItems] = useState<EmploymentUser[]>([]);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<EmploymentUser | null>(null);
  const [companyName, setCompanyName] = useState("");
  const [emailDomain, setEmailDomain] = useState("");
  const [validityMonths, setValidityMonths] = useState("12");
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const loadRecent = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/admin/employment-verifications", { cache: "no-store" });
      const body = (await res.json().catch(() => ({}))) as ApiResponse;
      if (!res.ok || body.ok === false) {
        throw new Error(body.error || "직장 인증 목록을 불러오지 못했습니다.");
      }
      setRecentItems(body.items ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "직장 인증 목록을 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadRecent();
  }, [loadRecent]);

  const selectUser = (item: EmploymentUser) => {
    setSelected(item);
    setCompanyName(item.verification?.company_name ?? "");
    setEmailDomain(item.verification?.email_domain ?? "");
    setValidityMonths("12");
    setError("");
    setMessage("");
  };

  const searchUsers = async (event?: FormEvent) => {
    event?.preventDefault();
    const normalized = query.trim();
    if (!normalized) {
      setError("닉네임, 회원 ID 또는 가입 이메일을 입력해주세요.");
      return;
    }

    setSearching(true);
    setError("");
    setMessage("");
    try {
      const res = await fetch(`/api/admin/employment-verifications?query=${encodeURIComponent(normalized)}`, {
        cache: "no-store",
      });
      const body = (await res.json().catch(() => ({}))) as ApiResponse;
      if (!res.ok || body.ok === false) {
        throw new Error(body.error || "회원 검색에 실패했습니다.");
      }
      const items = body.items ?? [];
      setSearchItems(items);
      if (items.length === 1) selectUser(items[0]);
      if (items.length === 0) setMessage("검색된 회원이 없습니다.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "회원 검색에 실패했습니다.");
    } finally {
      setSearching(false);
    }
  };

  const saveVerification = async () => {
    if (!selected || saving) return;
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const res = await fetch("/api/admin/employment-verifications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "verify",
          userId: selected.userId,
          companyName,
          emailDomain,
          validityMonths: Number(validityMonths),
        }),
      });
      const body = (await res.json().catch(() => ({}))) as ApiResponse;
      if (!res.ok || body.ok === false || !body.item) {
        throw new Error(body.error || "직장 인증 저장에 실패했습니다.");
      }
      const next = { ...selected, verification: body.item };
      setSelected(next);
      setSearchItems((prev) => prev.map((item) => (item.userId === next.userId ? next : item)));
      setMessage(`${selected.nickname || selected.userId.slice(0, 8)} 회원의 직장 인증을 저장했습니다.`);
      await loadRecent();
    } catch (err) {
      setError(err instanceof Error ? err.message : "직장 인증 저장에 실패했습니다.");
    } finally {
      setSaving(false);
    }
  };

  const revokeVerification = async (item: EmploymentUser) => {
    if (saving || !item.verification) return;
    const reason = window.prompt("직장 인증 취소 사유를 입력해주세요.", "관리자 확인에 따른 인증 취소")?.trim();
    if (!reason || !window.confirm(`${item.nickname || item.userId.slice(0, 8)} 회원의 직장 인증을 취소할까요?`)) return;

    setSaving(true);
    setError("");
    setMessage("");
    try {
      const res = await fetch("/api/admin/employment-verifications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "revoke", userId: item.userId, reason }),
      });
      const body = (await res.json().catch(() => ({}))) as ApiResponse;
      if (!res.ok || body.ok === false || !body.item) throw new Error(body.error || "직장 인증 취소에 실패했습니다.");
      const update = (candidate: EmploymentUser) =>
        candidate.userId === item.userId ? { ...candidate, verification: body.item ?? null } : candidate;
      setSearchItems((prev) => prev.map(update));
      setSelected((prev) => (prev ? update(prev) : prev));
      setMessage("직장 인증을 취소했습니다.");
      await loadRecent();
    } catch (err) {
      setError(err instanceof Error ? err.message : "직장 인증 취소에 실패했습니다.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-violet-200 bg-white p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-sm font-bold text-violet-950">직장인 인증 관리</p>
            <p className="mt-1 text-xs leading-5 text-neutral-600">
              현재는 관리자 수동 인증 단계입니다. 회사 이메일 주소 전체는 저장하지 않고 회사명과 도메인만 저장합니다.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void loadRecent()}
            disabled={loading || saving}
            className="h-9 rounded-lg border border-violet-200 bg-violet-50 px-4 text-xs font-semibold text-violet-800 disabled:opacity-50"
          >
            {loading ? "불러오는 중..." : "목록 새로고침"}
          </button>
        </div>
        {error ? <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p> : null}
        {message ? <p className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-700">{message}</p> : null}
      </div>

      <div className="rounded-xl border border-neutral-200 bg-white p-4">
        <p className="text-sm font-semibold text-neutral-900">회원 검색</p>
        <form onSubmit={(event) => void searchUsers(event)} className="mt-3 flex flex-col gap-2 sm:flex-row">
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="닉네임, 회원 UUID 또는 가입 이메일"
            className="h-10 min-w-0 flex-1 rounded-lg border border-neutral-300 px-3 text-sm outline-none focus:border-violet-400"
          />
          <button
            type="submit"
            disabled={searching}
            className="h-10 rounded-lg bg-violet-600 px-5 text-sm font-semibold text-white disabled:opacity-50"
          >
            {searching ? "검색 중..." : "검색"}
          </button>
        </form>

        {searchItems.length > 0 ? (
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {searchItems.map((item) => (
              <button
                key={item.userId}
                type="button"
                onClick={() => selectUser(item)}
                className={`rounded-lg border p-3 text-left ${selected?.userId === item.userId ? "border-violet-500 bg-violet-50" : "border-neutral-200 bg-white"}`}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold text-neutral-900">{item.nickname || "닉네임 없음"}</span>
                  {item.isBanned ? <span className="rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-semibold text-red-700">밴 회원</span> : null}
                  {item.verification ? (
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${STATUS_STYLE[item.verification.effective_status]}`}>
                      {STATUS_LABEL[item.verification.effective_status]}
                    </span>
                  ) : null}
                </div>
                {item.accountEmail ? <p className="mt-1 text-xs text-neutral-600">가입 이메일 {item.accountEmail}</p> : null}
                <p className="mt-1 break-all text-[10px] text-neutral-400">{item.userId}</p>
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {selected ? (
        <div className="rounded-xl border border-emerald-200 bg-white p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-sm font-bold text-neutral-950">{selected.nickname || "닉네임 없음"} 직장 인증 설정</p>
              <p className="mt-1 break-all text-[10px] text-neutral-400">{selected.userId}</p>
            </div>
            {selected.verification ? (
              <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${STATUS_STYLE[selected.verification.effective_status]}`}>
                {STATUS_LABEL[selected.verification.effective_status]}
              </span>
            ) : null}
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <label className="text-xs font-medium text-neutral-700">
              회사명
              <input
                value={companyName}
                onChange={(event) => setCompanyName(event.target.value)}
                maxLength={80}
                placeholder="예: 삼성전자"
                className="mt-1 h-10 w-full rounded-lg border border-neutral-300 px-3 text-sm"
              />
            </label>
            <label className="text-xs font-medium text-neutral-700">
              회사 이메일 도메인
              <input
                value={emailDomain}
                onChange={(event) => setEmailDomain(event.target.value)}
                maxLength={253}
                placeholder="예: samsung.com"
                className="mt-1 h-10 w-full rounded-lg border border-neutral-300 px-3 text-sm"
              />
            </label>
            <label className="text-xs font-medium text-neutral-700">
              유효기간
              <select
                value={validityMonths}
                onChange={(event) => setValidityMonths(event.target.value)}
                className="mt-1 h-10 w-full rounded-lg border border-neutral-300 bg-white px-3 text-sm"
              >
                <option value="3">3개월</option>
                <option value="6">6개월</option>
                <option value="12">12개월</option>
                <option value="24">24개월</option>
              </select>
            </label>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void saveVerification()}
              disabled={saving || !companyName.trim() || !emailDomain.trim()}
              className="h-10 rounded-lg bg-emerald-600 px-5 text-sm font-semibold text-white disabled:opacity-50"
            >
              {saving ? "저장 중..." : selected.verification ? "인증 갱신" : "직장 인증 부여"}
            </button>
            {selected.verification?.effective_status === "verified" ? (
              <button
                type="button"
                onClick={() => void revokeVerification(selected)}
                disabled={saving}
                className="h-10 rounded-lg border border-red-200 bg-red-50 px-5 text-sm font-semibold text-red-700 disabled:opacity-50"
              >
                인증 취소
              </button>
            ) : null}
          </div>
          <p className="mt-3 text-[11px] leading-5 text-neutral-500">
            관리자 수동 인증은 실제 회사 이메일 소유를 확인한 뒤에만 부여하세요. Gmail·네이버·카카오 등 개인 이메일 도메인은 저장할 수 없습니다.
          </p>
        </div>
      ) : null}

      <div className="rounded-xl border border-neutral-200 bg-white p-4">
        <p className="text-sm font-semibold text-neutral-900">최근 직장 인증</p>
        {loading ? (
          <p className="mt-3 text-sm text-neutral-500">불러오는 중...</p>
        ) : recentItems.length === 0 ? (
          <p className="mt-3 text-sm text-neutral-500">아직 직장 인증 내역이 없습니다.</p>
        ) : (
          <div className="mt-3 space-y-2">
            {recentItems.map((item) => {
              const verification = item.verification;
              if (!verification) return null;
              return (
                <div key={item.userId} className="rounded-lg border border-neutral-200 p-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-semibold text-neutral-900">{item.nickname || item.userId.slice(0, 8)}</span>
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${STATUS_STYLE[verification.effective_status]}`}>
                          {STATUS_LABEL[verification.effective_status]}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-neutral-700">{verification.company_name} · @{verification.email_domain}</p>
                      <p className="mt-1 text-[10px] text-neutral-500">
                        인증 {new Date(verification.verified_at).toLocaleString("ko-KR")} · 만료 {new Date(verification.expires_at).toLocaleDateString("ko-KR")}
                      </p>
                      {verification.revoke_reason ? <p className="mt-1 text-xs text-red-700">취소 사유: {verification.revoke_reason}</p> : null}
                    </div>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => selectUser(item)}
                        className="h-8 rounded-md border border-neutral-200 bg-white px-3 text-xs font-medium text-neutral-700"
                      >
                        수정
                      </button>
                      {verification.effective_status === "verified" ? (
                        <button
                          type="button"
                          onClick={() => void revokeVerification(item)}
                          disabled={saving}
                          className="h-8 rounded-md border border-red-200 bg-red-50 px-3 text-xs font-medium text-red-700 disabled:opacity-50"
                        >
                          취소
                        </button>
                      ) : null}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
