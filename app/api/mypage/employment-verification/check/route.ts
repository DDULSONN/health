import { NextResponse } from "next/server";
import {
  companyAllowsEmailDomain,
  findEmploymentCompanyById,
  loadEmploymentCompanyDirectory,
} from "@/lib/employment-company-directory";
import { validateWorkEmail, validateWorkEmailMailboxDomain } from "@/lib/employment-verification";
import { ensureAllowedMutationOrigin } from "@/lib/request-origin";
import { checkRouteRateLimit, extractClientIp } from "@/lib/request-rate-limit";
import { createAdminClient, createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  const originResponse = ensureAllowedMutationOrigin(request);
  if (originResponse) return originResponse;

  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ ok: false, error: "로그인이 필요합니다." }, { status: 401 });

    const rateLimit = await checkRouteRateLimit({
      requestId,
      scope: "mypage-employment-email-check",
      userId: user.id,
      ip: extractClientIp(request),
      userLimitPerMin: 10,
      ipLimitPerMin: 40,
      path: "/api/mypage/employment-verification/check",
    });
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { ok: false, error: `${rateLimit.retryAfterSec}초 후 다시 확인해주세요.`, retryAfterSec: rateLimit.retryAfterSec },
        { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSec) } }
      );
    }

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const email = validateWorkEmail(body.email);
    if (!email.ok) {
      return NextResponse.json({ ok: false, eligible: false, error: email.error }, { status: 400 });
    }

    const directory = await loadEmploymentCompanyDirectory(createAdminClient());
    const company = findEmploymentCompanyById(directory.companies, body.companyId);
    if (!company) {
      return NextResponse.json(
        { ok: false, eligible: false, error: "인증할 회사를 목록에서 선택해주세요." },
        { status: 400 }
      );
    }
    if (!companyAllowsEmailDomain(company, email.domain)) {
      return NextResponse.json(
        {
          ok: false,
          eligible: false,
          code: "COMPANY_DOMAIN_MISMATCH",
          error: `${company.name}에 등록된 회사 이메일 도메인과 일치하지 않습니다.`,
        },
        { status: 400 }
      );
    }

    const result = await validateWorkEmailMailboxDomain(body.email);
    if (!result.ok) {
      return NextResponse.json(
        { ok: false, eligible: false, error: result.error },
        { status: "temporary" in result && result.temporary ? 503 : 400 }
      );
    }

    return NextResponse.json({
      ok: true,
      eligible: true,
      domain: result.domain,
      company: { id: company.id, name: company.name },
      message: `${company.name}의 승인된 직장 이메일 도메인으로 확인했습니다.`,
    });
  } catch (error) {
    console.error("[POST /api/mypage/employment-verification/check] failed", { requestId, error });
    return NextResponse.json({ ok: false, error: "직장 이메일 확인 중 오류가 발생했습니다." }, { status: 500 });
  }
}
