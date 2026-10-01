export default function PhotoPreparationStatus({ pending, errors }: { pending: number[]; errors: string[] }) {
  return <div className="mt-2 space-y-1 text-xs leading-5" aria-live="polite" aria-atomic="true">
    {[0, 1].map(slot => pending.includes(slot)
      ? <p key={slot} className="text-neutral-600">사진 {slot + 1} 처리 중…</p>
      : errors[slot] ? <p key={slot} className="text-red-600">사진 {slot + 1}: {errors[slot]} 기존 사진과 작성 내용은 유지돼요.</p> : null)}
  </div>;
}
