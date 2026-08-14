type DiagnosticRow = Record<string, unknown>;

export default function AdminOpenCardRepostDiagnostics({ rows }: { rows: DiagnosticRow[] }) {
  if (rows.length === 0) return null;

  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-xs font-semibold text-amber-950">오픈카드 유료 재노출 진단</p>
          <p className="mt-1 text-[11px] text-amber-800">
            결제 승인, 대상 카드 존재 여부, 삭제 및 남은 이용시간 이전 기록을 함께 표시합니다.
          </p>
        </div>
        <span className="rounded-full bg-white px-2 py-1 text-[11px] font-semibold text-amber-800">{rows.length}건</span>
      </div>

      <div className="mt-3 space-y-2">
        {rows.map((row, index) => {
          const needsAttention = row.needs_attention === true;
          const amount = Number(row.amount ?? 0);
          const paidAt = typeof row.paid_at === "string" ? row.paid_at : "";
          const expiresAt = typeof row.expected_expires_at === "string" ? row.expected_expires_at : "";
          const targetStatus = typeof row.current_target_card_status === "string" ? row.current_target_card_status : "";
          const latestStatus = typeof row.latest_open_card_status === "string" ? row.latest_open_card_status : "";
          const fulfillmentStatus = String(row.fulfillment_status ?? "-");
          return (
            <div
              key={String(row.id ?? index)}
              className={`rounded-lg border bg-white p-3 ${needsAttention ? "border-rose-300" : "border-amber-100"}`}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs font-semibold text-neutral-900">
                  {amount > 0 ? `${amount.toLocaleString("ko-KR")}원` : "유료"} 재노출 · {String(row.order_status ?? "-")}
                </p>
                <span
                  className={`rounded-full px-2 py-1 text-[11px] font-bold ${
                    needsAttention ? "bg-rose-100 text-rose-700" : "bg-emerald-100 text-emerald-700"
                  }`}
                >
                  {needsAttention ? "확인 필요" : fulfillmentStatus === "transferred" ? "새 카드로 이전됨" : "정상"}
                </span>
              </div>
              <div className="mt-2 grid gap-1 text-[11px] text-neutral-600 sm:grid-cols-2">
                <p>결제 승인: {paidAt ? new Date(paidAt).toLocaleString("ko-KR") : "미승인"}</p>
                <p>이용 종료: {expiresAt ? new Date(expiresAt).toLocaleString("ko-KR") : "확인 불가"}</p>
                <p>결제 대상 카드: {targetStatus || "없음/삭제됨"}</p>
                <p>현재 최신 카드: {latestStatus || "없음"}</p>
                <p className="break-all sm:col-span-2">결제 대상 ID: {String(row.original_card_id ?? "-")}</p>
                {row.transferred_at ? (
                  <p className="sm:col-span-2">이전 처리: {new Date(String(row.transferred_at)).toLocaleString("ko-KR")}</p>
                ) : null}
                {row.deleted_at ? (
                  <p className="text-rose-700 sm:col-span-2">삭제 확인: {new Date(String(row.deleted_at)).toLocaleString("ko-KR")}</p>
                ) : null}
              </div>
              {needsAttention ? (
                <p className="mt-2 rounded-md bg-rose-50 px-2 py-1.5 text-[11px] font-medium text-rose-700">
                  결제는 완료됐지만 대상 카드가 없습니다. 최신 카드 상태를 확인해 재노출 시간을 복구해야 합니다.
                </p>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
