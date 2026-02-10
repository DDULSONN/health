"use client";

/**
 * 쿠팡 파트너스 iframe 안전 렌더기
 *
 * embedHtml에서 iframe src만 추출하고,
 * src가 https://coupa.ng/ 로 시작하는 경우에만 렌더링.
 * dangerouslySetInnerHTML 없이 안전한 JSX <iframe />을 직접 생성한다.
 */

const ALLOWED_ORIGIN = "https://coupa.ng/";

function extractIframeSrc(html: string): string | null {
  const match = html.match(/src=["']([^"']+)["']/);
  if (!match) return null;
  const src = match[1];
  return src.startsWith(ALLOWED_ORIGIN) ? src : null;
}

interface CoupangEmbedProps {
  embedHtml: string;
  className?: string;
}

export default function CoupangEmbed({
  embedHtml,
  className = "",
}: CoupangEmbedProps) {
  const src = extractIframeSrc(embedHtml);

  if (!src) {
    return (
      <div
        className={`flex items-center justify-center bg-neutral-100 rounded-xl text-sm text-neutral-400 h-[240px] ${className}`}
      >
        표시할 수 없는 링크
      </div>
    );
  }

  return (
    <div className={`flex justify-center ${className}`}>
      <iframe
        src={src}
        width={120}
        height={240}
        frameBorder={0}
        scrolling="no"
        referrerPolicy="unsafe-url"
        loading="lazy"
        title="쿠팡 파트너스 상품"
        className="border-0"
      />
    </div>
  );
}
