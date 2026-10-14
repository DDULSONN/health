import type { RegistrationSexCounts } from "@/lib/admin-registration-counts";

export default function AdminRegistrationSexCounts({ counts }: { counts?: RegistrationSexCounts | null }) {
  // Old cached responses have no breakdown: do not present missing data as zero.
  if (!counts) return null;
  return (
    <p className="mt-1 flex flex-wrap gap-x-2 gap-y-1 text-xs font-normal text-neutral-500">
      <span className="whitespace-nowrap">남 {counts.male.toLocaleString("ko-KR")}건</span>
      <span className="whitespace-nowrap">여 {counts.female.toLocaleString("ko-KR")}건</span>
      {counts.unknown > 0 ? <span className="whitespace-nowrap">미확인 {counts.unknown.toLocaleString("ko-KR")}건</span> : null}
    </p>
  );
}
