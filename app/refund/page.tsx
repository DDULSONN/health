import type { Metadata } from "next";
import LegalPageLayout from "@/components/LegalPageLayout";

export const metadata: Metadata = {
  title: "환불 및 취소 규정",
  description: "짐툴 유료 서비스 환불 및 취소 규정",
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="text-lg font-semibold text-neutral-900">{title}</h2>
      <div className="space-y-2">{children}</div>
    </section>
  );
}

export default function RefundPage() {
  return (
    <LegalPageLayout
      title="환불 및 취소 규정"
      description="유료 소개팅 상품과 기타 유료 기능 이용 전 확인해야 하는 기본 안내입니다."
      updatedAt="2026.04.05"
    >
      <Section title="1. 결제 전 확인사항">
        <p>각 상품의 가격, 제공 방식, 이용 시간, 노출 방식, 승인 절차는 해당 상품 안내 화면을 기준으로 적용됩니다.</p>
        <p>유료 소개팅 상품은 일반 재화가 아니라 일정 기간 노출, 열람, 추가 기능 제공 형태의 디지털 서비스입니다.</p>
      </Section>

      <Section title="2. 환불 검토가 가능한 경우">
        <p>결제는 완료되었으나 서비스 제공이 시작되지 않았고, 시스템 오류 또는 운영상 사유로 정상 이용이 어려운 경우에는 운영 확인 후 환불을 검토할 수 있습니다.</p>
        <p>중복 결제, 오결제 등 명백한 결제 오류가 확인되는 경우에도 문의 접수 후 확인 절차를 거쳐 처리합니다.</p>
      </Section>

      <Section title="3. 환불이 제한될 수 있는 경우">
        <p>유료 노출, 이상형 더보기, 지원권 지급, 매칭 열람 등 서비스 제공이 이미 시작된 경우에는 환불이 제한될 수 있습니다.</p>
        <p>이용자의 입력 실수, 단순 변심, 안내 확인 부족, 프로필 내용 변경 요청 등은 서비스 제공 이후 환불 사유로 인정되지 않을 수 있습니다.</p>
      </Section>

      <Section title="4. 상품별 기본 기준">
        <p>오픈카드 유료 등록은 결제 후 노출 또는 승인 절차가 시작되면 서비스 제공이 개시된 것으로 봅니다.</p>
        <p>이상형 더보기, 가까운 이상형 등 열람형 상품은 승인 또는 접근 권한 부여 이후 환불이 제한될 수 있습니다.</p>
        <p>지원권 구매는 지급이 완료된 뒤에는 사용 여부와 무관하게 환불이 제한될 수 있습니다.</p>
      </Section>

      <Section title="5. 문의처">
        <p>환불, 취소, 결제 관련 문의는 아래 채널로 접수해 주세요.</p>
        <p className="font-medium text-neutral-900">이메일: gymtools.kr@gmail.com</p>
        <p className="font-medium text-neutral-900">연락처: 010-8693-0657</p>
      </Section>

      <p className="rounded-2xl bg-neutral-50 px-4 py-3 text-xs leading-6 text-neutral-500">
        실제 환불 가능 여부는 결제 시점, 서비스 제공 여부, 운영 확인 결과에 따라 달라질 수 있으며, 개별 문의 기준으로 검토됩니다.
      </p>
    </LegalPageLayout>
  );
}
