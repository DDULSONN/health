import { createAdminClient } from "@/lib/supabase/server";

type PageProps = {
  params: Promise<{ slug: string }>;
};

type CertJoinRow = {
  certificate_no: string;
  issued_at: string;
  is_public: boolean;
  cert_requests: {
    nickname: string | null;
    sex: "male" | "female";
    bodyweight: number | null;
    squat: number;
    bench: number;
    deadlift: number;
    total: number;
    status: "pending" | "needs_info" | "rejected" | "approved";
  } | null;
};

export default async function CertVerifyPage({ params }: PageProps) {
  const { slug } = await params;
  const admin = createAdminClient();

  // Strict lookup: slug -> certificates(1 row) -> request_id join(cert_requests)
  const { data } = await admin
    .from("certificates")
    .select(
      "certificate_no, issued_at, is_public, cert_requests!inner(nickname, sex, bodyweight, squat, bench, deadlift, total, status)",
    )
    .eq("slug", slug)
    .maybeSingle();

  const row = data as CertJoinRow | null;
  const req = row?.cert_requests ?? null;
  const notFound =
    !row ||
    !req ||
    row.is_public !== true ||
    req.status !== "approved";

  if (notFound) {
    return (
      <main className="max-w-xl mx-auto px-4 py-10">
        <h1 className="text-2xl font-bold text-red-600">❌ 인증 정보를 찾을 수 없습니다</h1>
      </main>
    );
  }

  const issuedDate = new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(row.issued_at));

  return (
    <main className="max-w-xl mx-auto px-4 py-10">
      <h1 className="text-3xl font-bold text-emerald-600 mb-5">✅ 인증되었습니다</h1>

      <div className="rounded-2xl border border-neutral-200 bg-white p-5 space-y-2">
        <p className="text-sm text-neutral-700">
          인증번호: <strong>{row.certificate_no}</strong>
        </p>
        <p className="text-sm text-neutral-700">
          발급일: <strong>{issuedDate}</strong>
        </p>
        <p className="text-sm text-neutral-700">
          닉네임: <strong>{req.nickname ?? "GymTools User"}</strong>
        </p>
        <p className="text-sm text-neutral-700">
          성별: <strong>{req.sex === "male" ? "남성" : "여성"}</strong>
        </p>
        {req.bodyweight ? (
          <p className="text-sm text-neutral-700">
            체중: <strong>{req.bodyweight} kg</strong>
          </p>
        ) : null}
        <p className="text-sm text-neutral-700">
          스쿼트/벤치/데드리프트:{" "}
          <strong>
            {req.squat} / {req.bench} / {req.deadlift} kg
          </strong>
        </p>
        <p className="text-sm text-neutral-700">
          합계: <strong>{req.total} kg</strong>
        </p>
        <p className="text-sm text-neutral-700">
          발급기관: <strong>GymTools</strong>
        </p>
      </div>
    </main>
  );
}

