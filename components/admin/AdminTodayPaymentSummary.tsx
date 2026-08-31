export type AdminTodayPaymentData = {
  date: string;
  startAt: string;
  endAt: string;
  revenueKrw: number;
  paidCount: number;
};

export default function AdminTodayPaymentSummary({ data }: { data: AdminTodayPaymentData | null }) {
  if (!data) return null;

  const updatedAt = new Date(data.endAt).toLocaleTimeString("ko-KR", {
    timeZone: "Asia/Seoul",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  return (
    <section aria-label="오늘 결제 현황" className="rounded-xl border border-violet-200 bg-violet-50/60 px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-x-5 gap-y-2">
        <div>
          <p className="text-sm font-semibold text-violet-900">오늘 결제 금액</p>
          <p className="mt-1 text-[11px] text-violet-700">{data.date} · 한국시간 00:00~{updatedAt} 기준</p>
        </div>
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <p className="text-2xl font-black tabular-nums text-violet-950">{data.revenueKrw.toLocaleString("ko-KR")}원</p>
          <p className="text-sm font-semibold text-violet-700">· {data.paidCount.toLocaleString("ko-KR")}건</p>
        </div>
      </div>
      <p className="mt-2 text-[11px] text-violet-700">결제 승인일 기준 · 취소·환불 제외 · 선택한 집계 기간과 무관</p>
    </section>
  );
}
