import type { ActiveOneOnOneCounts } from "@/lib/admin-active-one-on-one-counts";

export default function AdminActiveOneOnOneCounts({ counts }: { counts?: ActiveOneOnOneCounts | null }) {
  return (
    <div className="rounded-2xl border border-violet-200 bg-white p-4">
      <p className="text-xs font-medium text-neutral-500">현재 활성 1:1 프로필</p>
      {counts ? (
        <>
          <p className="mt-2 text-2xl font-black text-neutral-900">{counts.total.toLocaleString("ko-KR")}명</p>
          <p className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-sm font-semibold text-neutral-700">
            <span className="whitespace-nowrap">남 {counts.male.toLocaleString("ko-KR")}명</span>
            <span className="whitespace-nowrap">여 {counts.female.toLocaleString("ko-KR")}명</span>
          </p>
          <p className="mt-2 text-xs text-neutral-500">탈퇴·밴·중복 제외 · 최근 접속 수와 달라요.</p>
        </>
      ) : (
        <p className="mt-2 text-xs text-neutral-500" role="status">
          {counts === null ? "집계하지 못했습니다. " : ""}운영 현황 새로고침을 눌러 주세요.
        </p>
      )}
    </div>
  );
}
