type Props = {
  total?: number | null;
  className?: string;
};

export default function VerifiedBadge({ total, className }: Props) {
  if (!Number.isFinite(total ?? NaN)) return null;
  return (
    <span
      className={
        className ??
        "inline-flex items-center rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700"
      }
    >
      ✅ 3대인증 {Math.round(Number(total))}kg
    </span>
  );
}
