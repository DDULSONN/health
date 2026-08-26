import { isValidCompanyDomain, normalizeCompanyName, normalizeEmailDomain } from "@/lib/employment-verification";
import { createAdminClient } from "@/lib/supabase/server";

export const EMPLOYMENT_COMPANY_DIRECTORY_KEY = "employment_company_directory";

export type EmploymentCompany = {
  id: string;
  name: string;
  domains: string[];
  active: boolean;
  created_at: string;
  updated_at: string;
};

type DirectoryPayload = {
  version: 1;
  companies: EmploymentCompany[];
};

type AdminClient = ReturnType<typeof createAdminClient>;

function normalizeCompany(raw: unknown): EmploymentCompany | null {
  if (!raw || typeof raw !== "object") return null;
  const item = raw as Partial<EmploymentCompany>;
  const id = typeof item.id === "string" ? item.id.trim() : "";
  const name = normalizeCompanyName(item.name);
  const domains = [
    ...new Set(
      (Array.isArray(item.domains) ? item.domains : [])
        .map((domain) => normalizeEmailDomain(domain))
        .filter((domain) => isValidCompanyDomain(domain))
    ),
  ].slice(0, 30);
  if (!id || !name || domains.length === 0) return null;
  const now = new Date().toISOString();
  return {
    id,
    name,
    domains,
    active: item.active !== false,
    created_at: typeof item.created_at === "string" ? item.created_at : now,
    updated_at: typeof item.updated_at === "string" ? item.updated_at : now,
  };
}

export function parseEmploymentCompanyDirectory(raw: unknown): DirectoryPayload {
  if (!raw || typeof raw !== "object") return { version: 1, companies: [] };
  const companies = Array.isArray((raw as { companies?: unknown }).companies)
    ? ((raw as { companies: unknown[] }).companies.map(normalizeCompany).filter(Boolean) as EmploymentCompany[])
    : [];
  return {
    version: 1,
    companies: companies
      .slice(0, 1000)
      .sort((left, right) => left.name.localeCompare(right.name, "ko")),
  };
}

export async function loadEmploymentCompanyDirectory(admin: AdminClient) {
  const { data, error } = await admin
    .from("site_settings")
    .select("value_json")
    .eq("key", EMPLOYMENT_COMPANY_DIRECTORY_KEY)
    .maybeSingle();
  if (error) throw error;
  return parseEmploymentCompanyDirectory(data?.value_json);
}

export async function saveEmploymentCompanyDirectory(
  admin: AdminClient,
  companies: EmploymentCompany[],
  updatedBy: string
) {
  const payload = parseEmploymentCompanyDirectory({ version: 1, companies });
  const { error } = await admin.from("site_settings").upsert(
    {
      key: EMPLOYMENT_COMPANY_DIRECTORY_KEY,
      value_json: payload,
      updated_at: new Date().toISOString(),
      updated_by: updatedBy,
    },
    { onConflict: "key" }
  );
  if (error) throw error;
  return payload;
}

export function findEmploymentCompanyById(companies: EmploymentCompany[], companyId: unknown) {
  const id = typeof companyId === "string" ? companyId.trim() : "";
  return companies.find((company) => company.active && company.id === id) ?? null;
}

export function companyAllowsEmailDomain(company: EmploymentCompany, emailDomain: unknown) {
  const domain = normalizeEmailDomain(emailDomain);
  return company.domains.includes(domain);
}

export function serializeEmploymentCompaniesForMember(companies: EmploymentCompany[]) {
  return companies
    .filter((company) => company.active)
    .map((company) => ({ id: company.id, name: company.name, domains: company.domains }));
}
