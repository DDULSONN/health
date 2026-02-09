/**
 * 광고 슬롯 플레이스홀더
 * 나중에 AdSense 스크립트만 끼우면 되도록 구조 준비
 */

interface AdSlotProps {
  className?: string;
  slotId?: string;
}

export default function AdSlot({ className = "", slotId = "default" }: AdSlotProps) {
  return (
    <div
      className={`w-full bg-neutral-50 border border-dashed border-neutral-200 rounded-xl flex items-center justify-center min-h-[90px] ${className}`}
      data-ad-slot={slotId}
      aria-hidden="true"
    >
      {/* 광고 영역 (AdSense 삽입 예정) */}
      <span className="text-xs text-neutral-300 select-none">AD</span>
    </div>
  );
}
