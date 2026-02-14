import AdminCertReviewPanel from "@/components/AdminCertReviewPanel";

export default function AdminCertRequestsPage() {
  return (
    <main className="max-w-4xl mx-auto px-4 py-8">
      <h1 className="text-2xl font-bold text-neutral-900 mb-4">인증 신청 관리</h1>
      <AdminCertReviewPanel />
    </main>
  );
}

