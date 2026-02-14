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

type StepName =
  | "auth_admin_check"
  | "env_service_role"
  | "env_site_url"
  | "db_get_request"
  | "db_issue_certificate_no"
  | "db_insert_certificate"
  | "qr_generate"
  | "pdf_font_load"
  | "pdf_generate"
  | "storage_bucket_check"
  | "storage_upload"
  | "db_update_certificate_pdf"
  | "db_update_request_status";

function fail(step: StepName, message: string, detail?: unknown, status = 500) {
  console.error("[cert-approve-fail]", {
    step,
    message,
    detail:
      detail instanceof Error
        ? { name: detail.name, message: detail.message, stack: detail.stack }
        : detail,
  });
  return NextResponse.json(
    {
      ok: false,
      step,
      message,
      detail:
        detail instanceof Error
          ? { name: detail.name, message: detail.message, stack: detail.stack }
          : detail,
    },
    { status },
  );
}

function toKstDate(value: string | Date): string {
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(value));
}

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  // step1: 관리자 권한 체크
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user || !isAdminEmail(user.email)) {
    return fail("auth_admin_check", "권한이 없습니다.", { email: user?.email }, 403);
  }

  // step1-2: service role/env check
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return fail("env_service_role", "Missing SUPABASE_SERVICE_ROLE_KEY", undefined, 500);
  }
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return fail("env_service_role", "Missing NEXT_PUBLIC_SUPABASE_URL", undefined, 500);
  }

  const siteUrlRaw = process.env.SITE_URL?.trim();
  if (!siteUrlRaw) {
    return fail("env_site_url", "Missing SITE_URL", undefined, 500);
  }
  const siteUrl = siteUrlRaw.replace(/\/+$/, "");

  const { id } = await params;
  const admin = createAdminClient();

  // step2: cert_requests 조회
  const { data: requestRow, error: requestError } = await admin
    .from("cert_requests")
    .select("*")
    .eq("id", id)
    .single();

  if (requestError || !requestRow) {
    return fail("db_get_request", requestError?.message ?? "인증 신청을 찾을 수 없습니다.", requestError, 404);
  }

  const certRequest = requestRow as CertRequestRecord;
  if (certRequest.status === "approved") {
    const { data: existingCert } = await admin
      .from("certificates")
      .select("id, certificate_no, slug, qr_url, pdf_url")
      .eq("request_id", certRequest.id)
      .maybeSingle();

    return NextResponse.json({ ok: true, step: "already_approved", certificate: existingCert });
  }

  // step3: certificates row 생성(slug/certificate_no/qr_url)
  let certificateNo = "";
  let slug = "";
  let qrUrl = "";
  let certId = "";

  const { data: existingForRequest, error: existingForRequestError } = await admin
    .from("certificates")
    .select("id, certificate_no, slug, qr_url")
    .eq("request_id", certRequest.id)
    .maybeSingle();
  if (existingForRequestError) {
    return fail("db_insert_certificate", existingForRequestError.message, existingForRequestError);
  }

  if (existingForRequest) {
    certId = existingForRequest.id;
    certificateNo = existingForRequest.certificate_no;
    slug = existingForRequest.slug;
    qrUrl = `${siteUrl}/cert/${slug}`;

    const { error: fixQrUrlError } = await admin
      .from("certificates")
      .update({ qr_url: qrUrl })
      .eq("id", certId);
    if (fixQrUrlError) {
      return fail("db_insert_certificate", fixQrUrlError.message, fixQrUrlError);
    }
  } else {
    const year = new Date().getUTCFullYear();
    const { data: nextNoData, error: nextNoError } = await admin.rpc("next_certificate_no", {
      p_year: year,
    });

    if (nextNoError || !nextNoData) {
      return fail("db_issue_certificate_no", nextNoError?.message ?? "인증번호 발급 실패", nextNoError);
    }

    certificateNo = String(nextNoData);
    slug = makeCertificateSlug();
    qrUrl = `${siteUrl}/cert/${slug}`;

    const { data: insertedCert, error: insertCertError } = await admin
      .from("certificates")
      .insert({
        request_id: certRequest.id,
        certificate_no: certificateNo,
        slug,
        qr_url: qrUrl,
        pdf_path: "",
        pdf_url: "",
        issued_at: new Date().toISOString(),
        is_public: true,
      })
      .select("id")
      .single();

    if (insertCertError || !insertedCert) {
      return fail(
        "db_insert_certificate",
        insertCertError?.message ?? "certificates insert 실패",
        insertCertError,
      );
    }

    certId = insertedCert.id;
  }

  // step4: QR 생성
  let qrDataUrl = "";
  try {
    qrDataUrl = await makeQrDataUrl(qrUrl);
    if (!qrDataUrl || !qrDataUrl.startsWith("data:image")) {
      return fail("qr_generate", "QR 데이터 URL 생성 결과가 올바르지 않습니다.", {
        qrDataUrlLength: qrDataUrl?.length ?? 0,
      });
    }
  } catch (error) {
    return fail("qr_generate", "QR 생성 실패", error);
  }

  // step5: PDF 생성
  let pdfBuffer: Buffer;
  try {
    pdfBuffer = await renderCertificatePdfBuffer({
      certificateNo,
      issuedAt: toKstDate(new Date()),
      nickname: certRequest.nickname ?? certRequest.email ?? "GymTools User",
      sexLabel: certRequest.sex,
      bodyweight: certRequest.bodyweight ? Number(certRequest.bodyweight) : null,
      squat: normalizeNumber(certRequest.squat),
      bench: normalizeNumber(certRequest.bench),
      deadlift: normalizeNumber(certRequest.deadlift),
      total: normalizeNumber(certRequest.total),
      verificationUrl: qrUrl,
      qrDataUrl,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? error.stack : undefined;
    console.error("[cert-approve-pdf-generate]", { message, stack });
    if (/\[pdf_font_load\]|font|NotoSansKR|ttf/i.test(message)) {
      return fail("pdf_font_load", message, stack?.slice(0, 2000) ?? error);
    }
    return fail("pdf_generate", message, stack?.slice(0, 2000) ?? error);
  }

  // step6: Storage 업로드 (bucket check + upload)
  const { data: bucketInfo, error: bucketError } = await admin
    .schema("storage")
    .from("buckets")
    .select("id, public")
    .eq("id", "certificates")
    .maybeSingle();

  if (bucketError || !bucketInfo) {
    return fail(
      "storage_bucket_check",
      "certificates bucket을 찾을 수 없습니다. Supabase SQL에서 bucket 생성 스크립트를 먼저 실행하세요.",
      bucketError,
    );
  }

  const uploadPath = `certificates/${certificateNo}.pdf`;
  const { error: uploadError } = await admin.storage
    .from("certificates")
    .upload(uploadPath, pdfBuffer, {
      contentType: "application/pdf",
      upsert: true,
    });

  if (uploadError) {
    return fail("storage_upload", uploadError.message, uploadError);
  }

  // step7: certificates.pdf_url 업데이트 (public/private 분기)
  let pdfUrl = "";
  if (bucketInfo.public) {
    const { data } = admin.storage.from("certificates").getPublicUrl(uploadPath);
    pdfUrl = data.publicUrl;
  } else {
    const { data, error } = await admin.storage
      .from("certificates")
      .createSignedUrl(uploadPath, 60 * 60 * 24 * 30);

    if (error || !data?.signedUrl) {
      return fail("db_update_certificate_pdf", "private bucket signed URL 생성 실패", error);
    }

    pdfUrl = data.signedUrl;
  }

  const { error: updateCertError } = await admin
    .from("certificates")
    .update({
      pdf_path: uploadPath,
      pdf_url: pdfUrl,
    })
    .eq("id", certId);

  if (updateCertError) {
    return fail("db_update_certificate_pdf", updateCertError.message, updateCertError);
  }

  // step8: cert_requests 상태 approved 업데이트
  const nowIso = new Date().toISOString();
  const { error: updateRequestError } = await admin
    .from("cert_requests")
    .update({
      status: "approved",
      reviewed_at: nowIso,
      admin_note: null,
    })
    .eq("id", certRequest.id);

  if (updateRequestError) {
    return fail("db_update_request_status", updateRequestError.message, updateRequestError);
  }

  return NextResponse.json({
    ok: true,
    step: "completed",
    certificate: {
      id: certId,
      certificate_no: certificateNo,
      slug,
      qr_url: qrUrl,
      pdf_url: pdfUrl,
    },
  });
}
