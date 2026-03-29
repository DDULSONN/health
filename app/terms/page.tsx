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
    <LegalPageLayout title="이용약관" description="짐툴 서비스 이용에 관한 기본 조건과 운영 원칙입니다." updatedAt="2026.03.29">
      <Section title="1. 서비스 내용">
        <p>짐툴은 운동 계산기, 커뮤니티, 몸평, 소개팅, 인증, 광고 문의 및 이에 부수되는 기능을 제공합니다.</p>
      </Section>

      <Section title="2. 회원의 의무">
        <p>회원은 허위 정보 등록, 타인 사칭, 불법 촬영물 또는 부적절한 콘텐츠 업로드, 욕설 및 비방, 금지된 광고성 게시물 작성, 서비스 운영 방해 행위를 해서는 안 됩니다.</p>
      </Section>

      <Section title="3. 소개팅 및 커뮤니티 운영">
        <p>소개팅과 커뮤니티 기능은 운영 정책에 따라 검토, 제한, 삭제될 수 있습니다. 신고 누적, 허위 정보, 불쾌한 표현, 부적절한 사진이나 연락처 남용이 확인되면 이용이 제한될 수 있습니다.</p>
      </Section>

      <Section title="4. 유료 서비스">
        <p>유료 서비스의 제공 범위, 노출 방식, 사용 기한은 각 서비스 안내 또는 환불/취소 규정에 따릅니다.</p>
      </Section>

      <Section title="5. 계정 탈퇴 및 제한">
        <p>회원은 언제든 탈퇴를 요청할 수 있으며, 운영자는 약관 위반 또는 서비스 안정성 확보를 위해 계정 이용을 제한할 수 있습니다.</p>
      </Section>

      <Section title="6. 책임 제한">
        <p>운영자는 천재지변, 외부 서비스 장애, 이용자 간 분쟁, 이용자 귀책 사유로 인한 손해에 대해 관련 법령 범위 내에서 책임을 제한할 수 있습니다.</p>
      </Section>
    </LegalPageLayout>
  );
}
