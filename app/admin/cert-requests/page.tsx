import AdminCertReviewPanel from "@/components/AdminCertReviewPanel";

export default function AdminCertRequestsPage() {
  return (
    <main className="mx-auto max-w-4xl px-4 py-8">
      <h1 className="mb-4 text-2xl font-bold text-neutral-900">인증 신청 관리</h1>
      <AdminCertReviewPanel />
    </main>
  );
}
