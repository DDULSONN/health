"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";

type Company = {
  id: string;
  name: string;
  domains: string[];
  active: boolean;
  created_at: string;
  updated_at: string;
};

type ApiResponse = {
  ok?: boolean;
  error?: string;
  companies?: Company[];
};

export default function AdminEmploymentCompanyDirectoryPanel() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [companyId, setCompanyId] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [domain, setDomain] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/admin/employment-companies", { cache: "no-store" });
      const body = (await response.json().catch(() => ({}))) as ApiResponse;
      if (!response.ok || body.ok === false) throw new Error(body.error || "회사·도메인 목록을 불러오지 못했습니다.");
      setCompanies(body.companies ?? []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "회사·도메인 목록을 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (saving || !companyName.trim() || !domain.trim()) return;
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/admin/employment-companies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "upsert", companyId: companyId || undefined, companyName, domain }),
      });
      const body = (await response.json().catch(() => ({}))) as ApiResponse;
      if (!response.ok || body.ok === false) throw new Error(body.error || "회사·도메인을 저장하지 못했습니다.");
      setCompanies(body.companies ?? []);
      setCompanyId("");
      setCompanyName("");
      setDomain("");
      setMessage("회사와 자동 인증 도메인을 저장했습니다.");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "회사·도메인을 저장하지 못했습니다.");
    } finally {
      setSaving(false);
    }
  };

  const removeDomain = async (company: Company, targetDomain: string) => {
    if (saving || !window.confirm(`${company.name}의 @${targetDomain} 자동 인증을 삭제할까요?`)) return;
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/admin/employment-companies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "remove_domain", companyId: company.id, domain: targetDomain }),
      });
      const body = (await response.json().catch(() => ({}))) as ApiResponse;
      if (!response.ok || body.ok === false) throw new Error(body.error || "회사 도메인을 삭제하지 못했습니다.");
      setCompanies(body.companies ?? []);
      setMessage("자동 인증 도메인을 삭제했습니다. 기존 인증은 유지됩니다.");
    } catch (removeError) {
      setError(removeError instanceof Error ? removeError.message : "회사 도메인을 삭제하지 못했습니다.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-xl border border-sky-200 bg-sky-50/40 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-bold text-sky-950">자동 인증 회사·도메인</p>
          <p className="mt-1 text-xs leading-5 text-neutral-600">
            사용자가 선택한 회사와 아래 승인 도메인이 일치할 때만 인증번호가 발송됩니다.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading || saving}
          className="h-8 rounded-md border border-sky-200 bg-white px-3 text-xs font-semibold text-sky-800 disabled:opacity-50"
        >
          새로고침
        </button>
      </div>

      <form onSubmit={(event) => void save(event)} className="mt-3 grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
        <input
          value={companyName}
          onChange={(event) => {
            setCompanyName(event.target.value);
            setCompanyId("");
          }}
          maxLength={80}
          placeholder="표준 회사명 (예: 삼성전자)"
          className="h-10 rounded-lg border border-sky-200 bg-white px-3 text-sm"
        />
        <input
          value={domain}
          onChange={(event) => setDomain(event.target.value)}
          maxLength={253}
          placeholder="회사 도메인 (예: samsung.com)"
          className="h-10 rounded-lg border border-sky-200 bg-white px-3 text-sm"
        />
        <button
          type="submit"
          disabled={saving || !companyName.trim() || !domain.trim()}
          className="h-10 rounded-lg bg-sky-700 px-4 text-sm font-semibold text-white disabled:opacity-50"
        >
          {saving ? "확인·저장 중..." : companyId ? "도메인 추가" : "회사 등록"}
        </button>
      </form>
      <p className="mt-2 text-[11px] leading-5 text-neutral-500">
        메일 수신 서버가 실제로 존재하는 도메인만 등록됩니다. 같은 도메인은 두 회사에 중복 등록할 수 없습니다.
      </p>

      {error ? <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p> : null}
      {message ? <p className="mt-2 rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-700">{message}</p> : null}

      {loading ? (
        <p className="mt-3 text-sm text-neutral-500">회사 목록을 불러오는 중...</p>
      ) : companies.length === 0 ? (
        <p className="mt-3 rounded-lg border border-dashed border-sky-200 bg-white p-3 text-xs text-neutral-600">
          등록된 회사가 없습니다. 회사와 공식 이메일 도메인을 먼저 등록해주세요.
        </p>
      ) : (
        <div className="mt-3 space-y-2">
          {companies.map((company) => (
            <div key={company.id} className="rounded-lg border border-sky-100 bg-white p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-semibold text-neutral-900">{company.name}</p>
                <button
                  type="button"
                  onClick={() => {
                    setCompanyId(company.id);
                    setCompanyName(company.name);
                    setDomain("");
                    setError("");
                    setMessage(`${company.name}에 추가할 도메인을 입력해주세요.`);
                  }}
                  className="h-7 rounded-md border border-sky-200 px-2 text-xs font-semibold text-sky-700"
                >
                  도메인 추가
                </button>
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                {company.domains.map((item) => (
                  <span key={item} className="inline-flex items-center gap-1 rounded-full bg-sky-50 px-2.5 py-1 text-xs text-sky-800">
                    @{item}
                    <button
                      type="button"
                      onClick={() => void removeDomain(company, item)}
                      disabled={saving}
                      aria-label={`${company.name} ${item} 삭제`}
                      className="ml-1 font-bold text-red-600 disabled:opacity-40"
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
