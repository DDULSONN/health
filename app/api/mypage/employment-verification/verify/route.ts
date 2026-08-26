import type { User } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { kvIncrWindow } from "@/lib/edge-kv";
import {
  companyAllowsEmailDomain,
  findEmploymentCompanyById,
  loadEmploymentCompanyDirectory,
} from "@/lib/employment-company-directory";
import {
  EMPLOYMENT_CHALLENGE_KEY,
  EMPLOYMENT_VERIFICATION_KEY,
  addEmploymentValidityMonths,
  hashWorkEmail,
  normalizeWorkEmail,
  readEmploymentChallenge,
  readEmploymentVerification,
  serializeEmploymentVerification,
  verifyEmploymentOtp,
  type EmploymentVerification,
} from "@/lib/employment-verification";
import { ensureAllowedMutationOrigin } from "@/lib/request-origin";
import { checkRouteRateLimit, extractClientIp } from "@/lib/request-rate-limit";
import { createAdminClient, createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

async function findOtherOwnerOfWorkEmail(emailHash: string, currentUserId: string) {
  const admin = createAdminClient();
  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    const owner = data.users.find((candidate: User) => {
      if (candidate.id === currentUserId) return false;
      return readEmploymentVerification(candidate)?.email_hash === emailHash;
    });
    if (owner) return owner.id;
    if (data.users.length < 1000) break;
  }
  return null;
}

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

    const ip = extractClientIp(request);
    const routeLimit = await checkRouteRateLimit({
      requestId,
      scope: "mypage-employment-otp-verify",
      userId: user.id,
      ip,
      userLimitPerMin: 8,
      ipLimitPerMin: 40,
      path: "/api/mypage/employment-verification/verify",
    });
    if (!routeLimit.allowed) {
      return NextResponse.json(
        { ok: false, error: `${routeLimit.retryAfterSec}초 후 다시 시도해주세요.`, retryAfterSec: routeLimit.retryAfterSec },
        { status: 429, headers: { "Retry-After": String(routeLimit.retryAfterSec) } }
      );
    }

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const email = normalizeWorkEmail(body.email);
    const code = typeof body.code === "string" ? body.code.trim() : "";
    if (!/^[0-9]{6}$/.test(code)) {
      return NextResponse.json({ ok: false, error: "이메일로 받은 6자리 인증번호를 입력해주세요." }, { status: 400 });
    }

    const emailHash = hashWorkEmail(email);
    const verifyLimit = await kvIncrWindow(`employment-otp-verify:${user.id}:${emailHash}:600`, 600);
    if (verifyLimit.count > 8) {
      return NextResponse.json(
        { ok: false, error: "인증번호 확인 횟수를 초과했습니다. 새 인증번호를 발송해주세요.", retryAfterSec: verifyLimit.ttlRemainingSec },
        { status: 429, headers: { "Retry-After": String(verifyLimit.ttlRemainingSec) } }
      );
    }

    const admin = createAdminClient();
    const { data: authData, error: authError } = await admin.auth.admin.getUserById(user.id);
    if (authError || !authData.user) throw authError ?? new Error("auth user missing");

    const current = readEmploymentVerification(authData.user);
    if (current?.status === "revoked") {
      return NextResponse.json({ ok: false, error: "관리자에 의해 직장 인증이 취소된 계정입니다." }, { status: 403 });
    }

    const challenge = readEmploymentChallenge(authData.user);
    if (!challenge) {
      return NextResponse.json({ ok: false, error: "먼저 직장 이메일로 인증번호를 발송해주세요." }, { status: 400 });
    }
    if (challenge.email_hash !== emailHash) {
      return NextResponse.json({ ok: false, error: "인증번호를 발송한 직장 이메일과 일치하지 않습니다." }, { status: 400 });
    }
    if (new Date(challenge.expires_at).getTime() <= Date.now()) {
      return NextResponse.json({ ok: false, error: "인증번호가 만료되었습니다. 새 인증번호를 발송해주세요." }, { status: 400 });
    }

    const directory = await loadEmploymentCompanyDirectory(admin);
    const company = findEmploymentCompanyById(directory.companies, challenge.company_id);
    if (!company || !companyAllowsEmailDomain(company, challenge.email_domain)) {
      return NextResponse.json(
        { ok: false, error: "회사 또는 이메일 도메인 승인이 변경되었습니다. 회사 선택부터 다시 진행해주세요." },
        { status: 409 }
      );
    }
    if (!verifyEmploymentOtp(challenge, user.id, code)) {
      return NextResponse.json({ ok: false, error: "인증번호가 맞지 않습니다." }, { status: 400 });
    }

    const claimLock = await kvIncrWindow(`employment-email-claim:${emailHash}`, 30);
    if (claimLock.count > 1) {
      return NextResponse.json({ ok: false, error: "인증 처리 중입니다. 잠시 후 상태를 다시 확인해주세요." }, { status: 409 });
    }
    if (await findOtherOwnerOfWorkEmail(emailHash, user.id)) {
      return NextResponse.json(
        { ok: false, error: "이미 다른 계정에서 인증한 직장 이메일입니다. 고객센터로 문의해주세요." },
        { status: 409 }
      );
    }

    const now = new Date().toISOString();
    const next: EmploymentVerification = {
      id: current?.id ?? crypto.randomUUID(),
      user_id: user.id,
      company_name: company.name,
      email_domain: challenge.email_domain,
      email_hash: challenge.email_hash,
      status: "verified",
      verification_method: "work_email",
      verified_at: now,
      expires_at: addEmploymentValidityMonths(12),
      verified_by_user_id: null,
      revoked_at: null,
      revoked_by_user_id: null,
      revoke_reason: null,
      created_at: current?.created_at ?? now,
      updated_at: now,
    };
    const { data: updated, error: updateError } = await admin.auth.admin.updateUserById(user.id, {
      app_metadata: {
        ...(authData.user.app_metadata ?? {}),
        [EMPLOYMENT_VERIFICATION_KEY]: next,
        [EMPLOYMENT_CHALLENGE_KEY]: null,
      },
    });
    if (updateError || !updated.user) throw updateError ?? new Error("updated user missing");

    console.info("[employment-otp-verify] verified", { requestId, userId: user.id, domain: challenge.email_domain });
    return NextResponse.json({
      ok: true,
      message: "직장 이메일 인증이 완료되었습니다.",
      verification: serializeEmploymentVerification(next),
    });
  } catch (error) {
    console.error("[POST /api/mypage/employment-verification/verify] failed", { requestId, error });
    return NextResponse.json({ ok: false, error: "인증번호 확인 중 오류가 발생했습니다." }, { status: 500 });
  }
}
