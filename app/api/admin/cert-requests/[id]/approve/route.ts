import { NextResponse } from "next/server";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { isAdminEmail } from "@/lib/admin";
import {
  makeCertificateSlug,
  makeQrDataUrl,
  normalizeNumber,
  type CertRequestRecord,
} from "@/lib/certificate";
import { renderCertificatePdfBuffer } from "@/lib/certificate-pdf";

export const runtime = "nodejs";

function toKstDate(value: string | Date): string {
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(value));
}

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user || !isAdminEmail(user.email)) {
    return NextResponse.json({ error: "권한이 없습니다." }, { status: 403 });
  }

  const { id } = await params;
  const admin = createAdminClient();

  const { data: requestRow, error: requestError } = await admin
    .from("cert_requests")
    .select("*")
    .eq("id", id)
    .single();

  if (requestError || !requestRow) {
    return NextResponse.json({ error: requestError?.message ?? "신청을 찾을 수 없습니다." }, { status: 404 });
  }

  const certRequest = requestRow as CertRequestRecord;
  if (certRequest.status === "approved") {
    const { data: existingCert } = await admin
      .from("certificates")
      .select("id, certificate_no, slug, pdf_url")
      .eq("request_id", certRequest.id)
      .maybeSingle();
    return NextResponse.json({ ok: true, certificate: existingCert });
  }

  const year = new Date().getUTCFullYear();
  const { data: nextNoData, error: nextNoError } = await admin.rpc("next_certificate_no", {
    p_year: year,
  });
  if (nextNoError || !nextNoData) {
    return NextResponse.json({ error: nextNoError?.message ?? "인증번호 발급 실패" }, { status: 500 });
  }

  const certificateNo = String(nextNoData);
  const slug = makeCertificateSlug();
  const siteUrl = (process.env.SITE_URL ?? "https://gymtools.kr").replace(/\/+$/, "");
  const verificationUrl = `${siteUrl}/cert/${slug}`;
  const qrDataUrl = await makeQrDataUrl(verificationUrl);

  const issuedAt = new Date();
  const pdfBuffer = await renderCertificatePdfBuffer({
    certificateNo,
    issuedAt: toKstDate(issuedAt),
    nickname: certRequest.nickname ?? certRequest.email ?? "GymTools User",
    sexLabel: certRequest.sex,
    bodyweight: certRequest.bodyweight ? Number(certRequest.bodyweight) : null,
    squat: normalizeNumber(certRequest.squat),
    bench: normalizeNumber(certRequest.bench),
    deadlift: normalizeNumber(certRequest.deadlift),
    total: normalizeNumber(certRequest.total),
    verificationUrl,
    qrDataUrl,
  });

  const filePath = `${certificateNo}.pdf`;
  const uploadPath = `certificates/${filePath}`;
  const { error: uploadError } = await admin.storage
    .from("certificates")
    .upload(uploadPath, pdfBuffer, {
      contentType: "application/pdf",
      upsert: true,
    });
  if (uploadError) {
    return NextResponse.json({ error: uploadError.message }, { status: 500 });
  }

  const { data: publicUrlData } = admin.storage.from("certificates").getPublicUrl(uploadPath);
  const pdfUrl = publicUrlData.publicUrl;

  const { error: certError } = await admin.from("certificates").insert({
    request_id: certRequest.id,
    certificate_no: certificateNo,
    slug,
    qr_url: verificationUrl,
    pdf_path: uploadPath,
    pdf_url: pdfUrl,
    issued_at: issuedAt.toISOString(),
    is_public: true,
  });
  if (certError) {
    return NextResponse.json({ error: certError.message }, { status: 500 });
  }

  const { error: updateError } = await admin
    .from("cert_requests")
    .update({
      status: "approved",
      reviewed_at: issuedAt.toISOString(),
      admin_note: null,
    })
    .eq("id", certRequest.id);
  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    certificate: {
      certificate_no: certificateNo,
      slug,
      pdf_url: pdfUrl,
      qr_url: verificationUrl,
    },
  });
}

