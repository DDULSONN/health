type PhoneVerifiedBadgeProps = {
  verified?: boolean | null;
  className?: string;
};

export default function PhoneVerifiedBadge({ verified, className = "" }: PhoneVerifiedBadgeProps) {
  if (!verified) return null;
  return (
    <span
      className={`inline-flex rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-[11px] font-medium text-sky-700 ${className}`.trim()}
    >
      인증 사용자
    </span>
  );
}
