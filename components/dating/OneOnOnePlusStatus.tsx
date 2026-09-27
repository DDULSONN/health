"use client";

export default function OneOnOnePlusStatus({ expiresAt, contactExchangeIncluded }: {
  expiresAt: string;
  contactExchangeIncluded: boolean;
}) {
  const date = new Date(expiresAt);
  const validDate = Number.isFinite(date.getTime());
  const shortDate = validDate ? date.toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric" }) : null;
  return <details className="mt-3 rounded-xl border border-neutral-200 bg-white px-3.5 text-neutral-700" data-one-on-one-plus-status>
    <summary className="flex min-h-[48px] cursor-pointer list-none flex-wrap items-center gap-x-2 gap-y-1 py-2 text-xs [&::-webkit-details-marker]:hidden">
      <span className="rounded-md bg-neutral-100 px-1.5 py-1 text-[10px] font-bold tracking-wide text-neutral-700">PLUS</span>
      <span className="font-semibold">이용 중</span>
      {shortDate && <span className="text-neutral-500">· {shortDate}까지</span>}
      <span className="ml-auto text-neutral-500 underline decoration-neutral-300 underline-offset-4">혜택 보기</span>
    </summary>
    <div className="border-t border-neutral-100 py-3 text-xs leading-5 text-neutral-600">
      <p>새로고침 최근 24시간 2회 · 프로필 우선 노출</p>
      <p className="mt-1">{contactExchangeIncluded ? "기존 혜택으로 번호교환이 포함돼요." : "번호교환은 별도로 결제해요."}</p>
      {validDate && <p className="mt-1 text-neutral-500">{date.toLocaleString("ko-KR", { timeZone: "Asia/Seoul", hour12: false })}까지 이용 가능 (한국 시간)</p>}
    </div>
  </details>;
}
