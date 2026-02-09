/**
 * 쿠팡 파트너스 고지문 (필수 문구)
 * 어떤 페이지에서든 재사용 가능
 */

interface CoupangNoticeProps {
  className?: string;
}

export default function CoupangNotice({ className = "" }: CoupangNoticeProps) {
  return (
    <div
      className={`bg-gray-50 rounded-xl p-3 ${className}`}
    >
      <p className="text-xs text-gray-500 text-center leading-relaxed">
        이 포스팅은 쿠팡 파트너스 활동의 일환으로, 이에 따른 일정액의 수수료를 제공받습니다.
      </p>
    </div>
  );
}
