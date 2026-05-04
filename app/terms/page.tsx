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
      description="짐툴 서비스 이용 조건, 회원의 의무, 운영 기준, 유료 기능 이용 기준을 안내합니다."
      updatedAt="2026.05.05"
    >
      <Section title="1. 서비스 범위">
        <p>
          짐툴은 운동 기록, 커뮤니티, 몸평, 오픈카드, 빠른매칭, 가까운 이상형 보기, 이상형 더보기, 1대1 소개팅, 결제 및 고객지원 기능을 제공합니다.
        </p>
      </Section>

      <Section title="2. 회원의 의무">
        <p>
          회원은 본인의 정확한 정보를 사용해야 하며, 허위 정보 등록, 타인 사칭, 불법 촬영물 공유, 모욕·성희롱·협박, 금전 요구, 외부 사기 유도, 연락처 무단 유출을 해서는 안 됩니다.
        </p>
      </Section>

      <Section title="3. 소개팅 및 연락처 교환">
        <p>
          오픈카드와 1대1 소개팅은 건전한 만남과 커뮤니케이션을 위한 기능입니다. 쌍방 수락, 결제, 관리자 승인 등 각 서비스의 절차가 완료되면 동의된 범위에서 연락처 또는 연결 정보가 공개될 수 있습니다.
        </p>
        <p>
          연락처가 공개된 이후 발생하는 대화, 만남, 분쟁은 이용자 본인의 판단과 책임이 따르며, 부적절한 행위가 확인되면 이용 제한 또는 계정 제재가 적용될 수 있습니다.
        </p>
      </Section>

      <Section title="4. 유료 서비스">
        <p>
          유료 상품의 가격, 제공 방식, 이용 기간, 노출 방식, 환불 제한은 각 상품 안내 화면과 환불/취소 규정을 기준으로 적용됩니다.
        </p>
        <p>
          즉시 열람, 노출 시작, 지원권 지급, 연락처 교환 등 서비스 제공이 시작된 상품은 단순 변심에 따른 환불이 제한될 수 있습니다.
        </p>
      </Section>

      <Section title="5. 게시물과 사진">
        <p>
          회원이 등록한 게시물, 사진, 프로필은 서비스 운영, 매칭, 랭킹, 신고 검수 목적에 따라 노출될 수 있습니다. 회원은 본인이 권리를 가진 콘텐츠만 등록해야 합니다.
        </p>
        <p>
          음란물, 불법 촬영물, 타인의 사진, 개인정보 무단 공개, 혐오·비방·성희롱 콘텐츠는 삭제되며 계정 제재가 적용될 수 있습니다.
        </p>
      </Section>

      <Section title="6. 계정 탈퇴 및 이용 제한">
        <p>
          회원은 언제든지 계정 탈퇴를 요청할 수 있습니다. 다만 부정 이용 방지, 환불 및 분쟁 대응, 법령상 보관이 필요한 정보는 일정 기간 보관될 수 있습니다.
        </p>
        <p>
          운영정책 위반, 신고 누적, 허위 정보, 금전 요구, 사기 또는 범죄 의심 행위가 확인되면 게시물 삭제, 기능 제한, 계정 정지 또는 탈퇴 처리가 이루어질 수 있습니다.
        </p>
      </Section>

      <Section title="7. 책임 제한">
        <p>
          짐툴은 안정적인 서비스 제공을 위해 노력하지만, 천재지변, 외부 결제사·통신사 장애, 이용자 간 분쟁 등 운영자의 합리적 통제를 벗어난 사유에 대해서는 법령이 허용하는 범위에서 책임이 제한될 수 있습니다.
        </p>
      </Section>
    </LegalPageLayout>
  );
}
