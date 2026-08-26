import { NextResponse } from "next/server";
import { recordAdminAuditEvent } from "@/lib/admin-audit";
import { requireAdminRoute } from "@/lib/admin-route";
import {
  loadEmploymentCompanyDirectory,
  saveEmploymentCompanyDirectory,
  type EmploymentCompany,
} from "@/lib/employment-company-directory";
import {
  normalizeCompanyName,
  normalizeEmailDomain,
  validateCompanyDomainMailbox,
} from "@/lib/employment-verification";
import { ensureAllowedMutationOrigin } from "@/lib/request-origin";

export async function GET() {
  const auth = await requireAdminRoute();
  if (!auth.ok) return auth.response;

  try {
    const directory = await loadEmploymentCompanyDirectory(auth.admin);
    return NextResponse.json({ ok: true, companies: directory.companies });
  } catch (error) {
    console.error("[GET /api/admin/employment-companies] failed", error);
    return NextResponse.json({ ok: false, error: "회사·도메인 목록을 불러오지 못했습니다." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  const originResponse = ensureAllowedMutationOrigin(request);
  if (originResponse) return originResponse;

  const auth = await requireAdminRoute();
  if (!auth.ok) return auth.response;

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const action = body.action === "remove_domain" ? "remove_domain" : "upsert";
  const companyId = typeof body.companyId === "string" ? body.companyId.trim() : "";
  const domain = normalizeEmailDomain(body.domain);

  try {
    const directory = await loadEmploymentCompanyDirectory(auth.admin);
    let companies = [...directory.companies];
    let target: EmploymentCompany | null = null;

    if (action === "remove_domain") {
      target = companies.find((company) => company.id === companyId) ?? null;
      if (!target || !domain || !target.domains.includes(domain)) {
        return NextResponse.json({ ok: false, error: "삭제할 회사 도메인을 찾지 못했습니다." }, { status: 404 });
      }

      const remainingDomains = target.domains.filter((candidate) => candidate !== domain);
      if (remainingDomains.length === 0) {
        companies = companies.filter((company) => company.id !== target?.id);
      } else {
        target = { ...target, domains: remainingDomains, updated_at: new Date().toISOString() };
        companies = companies.map((company) => (company.id === target?.id ? target : company));
      }
    } else {
      const companyName = normalizeCompanyName(body.companyName);
      if (!companyName) {
        return NextResponse.json({ ok: false, error: "회사명을 입력해주세요." }, { status: 400 });
      }

      const domainResult = await validateCompanyDomainMailbox(domain);
      if (!domainResult.ok) {
        return NextResponse.json(
          { ok: false, error: domainResult.error },
          { status: domainResult.temporary ? 503 : 400 }
        );
      }

      const conflicting = companies.find(
        (company) => company.domains.includes(domainResult.domain) && company.id !== companyId
      );
      if (conflicting) {
        return NextResponse.json(
          { ok: false, error: `@${domainResult.domain} 도메인은 이미 ${conflicting.name}에 등록되어 있습니다.` },
          { status: 409 }
        );
      }

      const normalizedName = companyName.toLocaleLowerCase("ko-KR");
      target =
        companies.find((company) => company.id === companyId) ??
        companies.find((company) => company.name.toLocaleLowerCase("ko-KR") === normalizedName) ??
        null;
      const now = new Date().toISOString();
      if (target) {
        target = {
          ...target,
          name: companyName,
          domains: [...new Set([...target.domains, domainResult.domain])],
          active: true,
          updated_at: now,
        };
        companies = companies.map((company) => (company.id === target?.id ? target : company));
      } else {
        target = {
          id: crypto.randomUUID(),
          name: companyName,
          domains: [domainResult.domain],
          active: true,
          created_at: now,
          updated_at: now,
        };
        companies.push(target);
      }
    }

    const saved = await saveEmploymentCompanyDirectory(auth.admin, companies, auth.user.id);
    await recordAdminAuditEvent({
      admin: auth.admin,
      adminUser: auth.user,
      request,
      action: action === "remove_domain" ? "employment_company_domain_remove" : "employment_company_domain_upsert",
      targetType: "employment_company",
      targetId: target?.id ?? (companyId || null),
      requestId,
      metadata: { companyName: target?.name ?? null, domain },
    });
    return NextResponse.json({ ok: true, companies: saved.companies });
  } catch (error) {
    console.error("[POST /api/admin/employment-companies] failed", error);
    return NextResponse.json({ ok: false, error: "회사·도메인 목록을 저장하지 못했습니다." }, { status: 500 });
  }
}
