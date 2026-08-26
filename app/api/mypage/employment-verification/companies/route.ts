import { NextResponse } from "next/server";
import {
  loadEmploymentCompanyDirectory,
  serializeEmploymentCompaniesForMember,
} from "@/lib/employment-company-directory";
import { createAdminClient, createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ ok: false, error: "로그인이 필요합니다." }, { status: 401 });

    const directory = await loadEmploymentCompanyDirectory(createAdminClient());
    return NextResponse.json(
      { ok: true, companies: serializeEmploymentCompaniesForMember(directory.companies) },
      { headers: { "Cache-Control": "private, no-store" } }
    );
  } catch (error) {
    console.error("[GET /api/mypage/employment-verification/companies] failed", error);
    return NextResponse.json({ ok: false, error: "인증 가능한 회사 목록을 불러오지 못했습니다." }, { status: 500 });
  }
}
