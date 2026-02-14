import { createAdminClient } from "@/lib/supabase/server";

type PageProps = {
  params: Promise<{ slug: string }>;
};

export default async function CertVerifyPage({ params }: PageProps) {
  const { slug } = await params;
  const admin = createAdminClient();

  const { data } = await admin
    .from("certificates_public")
    .select("*")
    .eq("slug", slug)
    .maybeSingle();

  if (!data) {
    return (
      <main className="max-w-xl mx-auto px-4 py-10">
        <h1 className="text-2xl font-bold text-red-600">❌ 인증 정보를 찾을 수 없습니다</h1>
      </main>
    );
  }

  return (
    <main className="max-w-xl mx-auto px-4 py-10">
      <h1 className="text-3xl font-bold text-emerald-600 mb-5">✅ 인증되었습니다</h1>

      <div className="rounded-2xl border border-neutral-200 bg-white p-5 space-y-2">
        <p className="text-sm text-neutral-700">
          인증번호: <strong>{data.certificate_no}</strong>
        </p>
        <p className="text-sm text-neutral-700">
          닉네임: <strong>{data.nickname ?? "GymTools User"}</strong>
        </p>
        <p className="text-sm text-neutral-700">
          성별: <strong>{data.sex === "male" ? "남성" : "여성"}</strong>
        </p>
        {data.bodyweight ? (
          <p className="text-sm text-neutral-700">
            체중: <strong>{data.bodyweight} kg</strong>
          </p>
        ) : null}
        <p className="text-sm text-neutral-700">
          스쿼트/벤치/데드: <strong>{data.squat} / {data.bench} / {data.deadlift} kg</strong>
        </p>
        <p className="text-sm text-neutral-700">
          총합: <strong>{data.total} kg</strong>
        </p>
        <p className="text-sm text-neutral-700">
          발급일: <strong>{new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(data.issued_at))}</strong>
        </p>
        <p className="text-sm text-neutral-700">
          발급기관: <strong>GymTools</strong>
        </p>
      </div>
    </main>
  );
}

