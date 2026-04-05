import type { Metadata } from "next";
import LegalPageLayout from "@/components/LegalPageLayout";

export const metadata: Metadata = {
  title: "이용약관",
  description: "짐툴 이용약관",
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="text-lg font-semibold text-neutral-900">{title}</h2>
      <div className="space-y-2">{children}</div>
    </section>
  );
}

export default function TermsPage() {
  return (
    <LegalPageLayout
      title="이용약관"
      description="짐툴 서비스 이용에 관한 기본 조건과 운영 원칙입니다."
      updatedAt="2026.04.05"
    >
      <Section title="1. 서비스 범위">
        <p>짐툴은 운동 계산기, 커뮤니티, 몸평, 소개팅, 인증, 광고 문의 등 사이트 내 제공 기능을 운영합니다.</p>
      </Section>

      <Section title="2. 회원의 의무">
        <p>회원은 타인의 정보를 도용하거나, 허위 정보를 등록하거나, 불법 촬영물, 음란물, 사기성 홍보물, 연락처 도배, 금전 요구 등 운영정책에 반하는 행위를 해서는 안 됩니다.</p>
      </Section>

      <Section title="3. 커뮤니티 및 소개팅 운영">
        <p>운영자는 서비스 안정성과 이용자 보호를 위해 게시물, 댓글, 프로필, 사진, 소개팅 신청 및 매칭 상태를 검토하거나 제한할 수 있습니다.</p>
        <p>운영정책 위반, 신고 누적, 허위 정보, 부적절한 표현이 확인되면 게시물 삭제, 이용 제한, 계정 제재가 이루어질 수 있습니다.</p>
      </Section>

      <Section title="4. 유료 서비스">
        <p>유료 상품의 제공 방식, 노출 시간, 열람 권한, 환불 제한은 각 상품 안내 및 환불/취소 규정을 따릅니다.</p>
      </Section>

      <Section title="5. 계정 탈퇴 및 제한">
        <p>회원은 언제든 탈퇴를 요청할 수 있으며, 운영자는 서비스 악용, 법령 위반, 정책 위반이 확인되는 경우 계정 이용을 제한할 수 있습니다.</p>
      </Section>

      <Section title="6. 책임 제한">
        <p>운영자는 천재지변, 외부 서비스 장애, 이용자 간 분쟁 등 회사의 합리적 통제를 벗어난 사유로 발생한 손해에 대해 법령이 허용하는 범위에서 책임을 제한할 수 있습니다.</p>
      </Section>
    </LegalPageLayout>
  );
}
